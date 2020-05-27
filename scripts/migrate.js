#!/usr/bin/env node
const assert = require('assert')
const chalk = require('chalk')
const runShell = require('./runShell')
const { Project } = require('oz-migrate')
const { exec } = require('./exec');

const { buildContext } = require('oz-console')

const ethers = require('ethers')

let consoleNetwork, networkConfig, ozNetworkName

const commander = require('commander');
const program = new commander.Command()
program.option('-r --rinkeby', 'run the migrations against rinkeby', () => true)
program.option('-k --kovan', 'run the migrations against kovan', () => true)
program.option('-v --verbose', 'make all commands verbose', () => true)
program.parse(process.argv)

if (program.rinkeby) {
  console.log(chalk.green('Selected network is rinkeby'))
  // The network that the oz-console app should talk to.  (should really just use the ozNetworkName)
  consoleNetwork = 'rinkeby'

  // The OpenZeppelin SDK network name
  ozNetworkName = 'rinkeby'

  // The OpenZeppelin SDK network config that oz-console should use as reference
  networkConfig = '.openzeppelin/rinkeby.json'
} else if (program.kovan) {
  console.log(chalk.green('Selected network is kovan'))
  // The network that the oz-console app should talk to.  (should really just use the ozNetworkName)
  consoleNetwork = 'kovan'

  // The OpenZeppelin SDK network name
  ozNetworkName = 'kovan'

  // The OpenZeppelin SDK network config that oz-console should use as reference
  networkConfig = '.openzeppelin/kovan.json'
} else {
  console.log(chalk.green('Selected network is local'))

  // The network that the oz-console app should talk to.  (should really just use the ozNetworkName)
  consoleNetwork = 'http://localhost:8545'

  // The OpenZeppelin SDK network name
  ozNetworkName = 'local'

  // The OpenZeppelin SDK network config that oz-console should use as reference
  networkConfig = '.openzeppelin/dev-1234.json'
}

function loadContext() {
  return buildContext({
    projectConfig: '.openzeppelin/project.json',
    network: consoleNetwork,
    networkConfig,
    directory: 'build/contracts',
    verbose: false,
    mnemonic: process.env.HDWALLET_MNEMONIC
  })
}

function generateSecret(poolSeed, drawId) {
    return ethers.utils.solidityKeccak256(['bytes32', 'uint256'], [poolSeed, drawId]);
}

function generateSecretHash(secret, salt) {
    return ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [secret, salt]);
}

async function mintToMoneyMarketAndWallets(context, tokenContract, moneyMarketAddress, amountInEth) {
  await tokenContract.mint(moneyMarketAddress, ethers.utils.parseEther('10000000'))
  let i;
  for (i = 0; i < 10; i++) {
    const wallet = await context.walletAtIndex(i)
    await tokenContract.mint(wallet.address, ethers.utils.parseEther(amountInEth))
    if (program.verbose) console.log(chalk.dim(`Minted to ${wallet.address}`))
  }

  if (process.env.MINT_ADDRESSES) {
    const extraAddresses = (process.env.MINT_ADDRESSES || '').split(',')

    for (i = 0; i < extraAddresses.length; i++) {
      await tokenContract.mint(extraAddresses[i], ethers.utils.parseEther(amountInEth))
      if (program.verbose) console.log(chalk.dim(`Minted to ${extraAddresses[i]}`))
    }
  }
}

// const ozOptions = program.verbose ? '' : '-s'
const ozOptions = ''

async function migrate() {
  const project = new Project('.oz-migrate')
  const migration = await project.migrationForNetwork(ozNetworkName)

  runShell(`oz compile ${ozOptions}`)

  runShell(`oz session ${ozOptions} --network ${ozNetworkName} --from ${process.env.ADMIN_ADDRESS} --expires 3600 --timeout 600`)

  let context = loadContext()

  const {
    provider,
    signer
  } = context

  const overrides = {
      gasLimit: 6000000,
  };

  await migration.migrate(20, () => {
    runShell(`oz create Sai ${ozOptions} --network ${ozNetworkName} --init initialize --args '${signer.address},"Sai","Sai",18'`)
  })

  await migration.migrate(24, () => {
    runShell(`oz create Dai ${ozOptions} --network ${ozNetworkName} --init initialize --args '${signer.address},"Dai","Dai",18'`)
    context = loadContext()
  })

  await migration.migrate(26, () => {
    runShell(`oz create ScdMcdMigrationMock ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.Sai.address},${context.contracts.Dai.address}`)
    context = loadContext()
  })

  const sai = context.contracts.Sai
  let supplyRateMantissa = '4960317460300' // about 20% per week

  await migration.migrate(30, () => runShell(`oz create cSai ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.Sai.address},${supplyRateMantissa}`))

  await migration.migrate(32, () => {
    runShell(`oz create cDai ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.Dai.address},${supplyRateMantissa}`)
    context = loadContext()
  })

  // Set up ERC1820
  await migration.migrate(36, async () => {
    const ERC_1820_SINGLE_USE_ADDRESS = '0xa990077c3205cbDf861e17Fa532eeB069cE9fF96'
    const ERC_1820_REGISTRY_ADDRESS = '0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24'
    const code = await provider.getCode(ERC_1820_REGISTRY_ADDRESS)
    if (code === '0x') {
      console.log('Deploying ERC1820')
      await signer.sendTransaction({ to: ERC_1820_SINGLE_USE_ADDRESS, value: ethers.utils.parseEther('0.08')})
      await provider.sendTransaction('0xf90a388085174876e800830c35008080b909e5608060405234801561001057600080fd5b506109c5806100206000396000f3fe608060405234801561001057600080fd5b50600436106100a5576000357c010000000000000000000000000000000000000000000000000000000090048063a41e7d5111610078578063a41e7d51146101d4578063aabbb8ca1461020a578063b705676514610236578063f712f3e814610280576100a5565b806329965a1d146100aa5780633d584063146100e25780635df8122f1461012457806365ba36c114610152575b600080fd5b6100e0600480360360608110156100c057600080fd5b50600160a060020a038135811691602081013591604090910135166102b6565b005b610108600480360360208110156100f857600080fd5b5035600160a060020a0316610570565b60408051600160a060020a039092168252519081900360200190f35b6100e06004803603604081101561013a57600080fd5b50600160a060020a03813581169160200135166105bc565b6101c26004803603602081101561016857600080fd5b81019060208101813564010000000081111561018357600080fd5b82018360208201111561019557600080fd5b803590602001918460018302840111640100000000831117156101b757600080fd5b5090925090506106b3565b60408051918252519081900360200190f35b6100e0600480360360408110156101ea57600080fd5b508035600160a060020a03169060200135600160e060020a0319166106ee565b6101086004803603604081101561022057600080fd5b50600160a060020a038135169060200135610778565b61026c6004803603604081101561024c57600080fd5b508035600160a060020a03169060200135600160e060020a0319166107ef565b604080519115158252519081900360200190f35b61026c6004803603604081101561029657600080fd5b508035600160a060020a03169060200135600160e060020a0319166108aa565b6000600160a060020a038416156102cd57836102cf565b335b9050336102db82610570565b600160a060020a031614610339576040805160e560020a62461bcd02815260206004820152600f60248201527f4e6f7420746865206d616e616765720000000000000000000000000000000000604482015290519081900360640190fd5b6103428361092a565b15610397576040805160e560020a62461bcd02815260206004820152601a60248201527f4d757374206e6f7420626520616e204552433136352068617368000000000000604482015290519081900360640190fd5b600160a060020a038216158015906103b85750600160a060020a0382163314155b156104ff5760405160200180807f455243313832305f4143434550545f4d4147494300000000000000000000000081525060140190506040516020818303038152906040528051906020012082600160a060020a031663249cb3fa85846040518363ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004018083815260200182600160a060020a0316600160a060020a031681526020019250505060206040518083038186803b15801561047e57600080fd5b505afa158015610492573d6000803e3d6000fd5b505050506040513d60208110156104a857600080fd5b5051146104ff576040805160e560020a62461bcd02815260206004820181905260248201527f446f6573206e6f7420696d706c656d656e742074686520696e74657266616365604482015290519081900360640190fd5b600160a060020a03818116600081815260208181526040808320888452909152808220805473ffffffffffffffffffffffffffffffffffffffff19169487169485179055518692917f93baa6efbd2244243bfee6ce4cfdd1d04fc4c0e9a786abd3a41313bd352db15391a450505050565b600160a060020a03818116600090815260016020526040812054909116151561059a5750806105b7565b50600160a060020a03808216600090815260016020526040902054165b919050565b336105c683610570565b600160a060020a031614610624576040805160e560020a62461bcd02815260206004820152600f60248201527f4e6f7420746865206d616e616765720000000000000000000000000000000000604482015290519081900360640190fd5b81600160a060020a031681600160a060020a0316146106435780610646565b60005b600160a060020a03838116600081815260016020526040808220805473ffffffffffffffffffffffffffffffffffffffff19169585169590951790945592519184169290917f605c2dbf762e5f7d60a546d42e7205dcb1b011ebc62a61736a57c9089d3a43509190a35050565b600082826040516020018083838082843780830192505050925050506040516020818303038152906040528051906020012090505b92915050565b6106f882826107ef565b610703576000610705565b815b600160a060020a03928316600081815260208181526040808320600160e060020a031996909616808452958252808320805473ffffffffffffffffffffffffffffffffffffffff19169590971694909417909555908152600284528181209281529190925220805460ff19166001179055565b600080600160a060020a038416156107905783610792565b335b905061079d8361092a565b156107c357826107ad82826108aa565b6107b85760006107ba565b815b925050506106e8565b600160a060020a0390811660009081526020818152604080832086845290915290205416905092915050565b6000808061081d857f01ffc9a70000000000000000000000000000000000000000000000000000000061094c565b909250905081158061082d575080155b1561083d576000925050506106e8565b61084f85600160e060020a031961094c565b909250905081158061086057508015155b15610870576000925050506106e8565b61087a858561094c565b909250905060018214801561088f5750806001145b1561089f576001925050506106e8565b506000949350505050565b600160a060020a0382166000908152600260209081526040808320600160e060020a03198516845290915281205460ff1615156108f2576108eb83836107ef565b90506106e8565b50600160a060020a03808316600081815260208181526040808320600160e060020a0319871684529091529020549091161492915050565b7bffffffffffffffffffffffffffffffffffffffffffffffffffffffff161590565b6040517f01ffc9a7000000000000000000000000000000000000000000000000000000008082526004820183905260009182919060208160248189617530fa90519096909550935050505056fea165627a7a72305820377f4a2d4301ede9949f163f319021a6e9c687c292a5e2b2c4734c126b524e6c00291ba01820182018201820182018201820182018201820182018201820182018201820a01820182018201820182018201820182018201820182018201820182018201820')
    }
  })

  const lockDuration = 40
  const cooldownDuration = 1
  const feeFraction = ethers.utils.parseEther('0.05')

  await migration.migrate(40, async () => {
    runShell(`oz create PoolSai ${ozOptions} --network ${ozNetworkName} --init init --args '${signer.address},${context.contracts.cSai.address},${feeFraction},${signer.address},${lockDuration},${cooldownDuration}'`)
    context = loadContext()
  })

  await migration.migrate(45, async () => {
    runShell(`oz create PoolSaiToken ${ozOptions} --network ${ozNetworkName} --init init --args '"Pool Sai","poolSai",[],${context.contracts.PoolSai.address}'`)
    context = loadContext()
  })

  await migration.migrate(46, async () => {
    await context.contracts.PoolSai.setPoolToken(context.contracts.PoolSaiToken.address)
  })

  await migration.migrate(50, async () => {
    runShell(`oz create PoolDai ${ozOptions} --network ${ozNetworkName} --init init --args '${signer.address},${context.contracts.cDai.address},${feeFraction},${signer.address},${lockDuration},${cooldownDuration}'`)
    context = loadContext()
  })

  await migration.migrate(55, async () => {
    runShell(`oz create PoolDaiToken ${ozOptions} --network ${ozNetworkName} --init init --args '"Pool Dai","poolDai",[],${context.contracts.PoolDai.address}'`)
    context = loadContext()
  })

  await migration.migrate(56, async () => {
    await context.contracts.PoolDai.setPoolToken(context.contracts.PoolDaiToken.address)
  })

  await migration.migrate(60, async () => {
    await context.contracts.PoolDai.initMigration(context.contracts.ScdMcdMigrationMock.address, context.contracts.PoolSai.address)
  })

  await migration.migrate(65, () => mintToMoneyMarketAndWallets(context, sai, context.contracts.cSai.address, '10000'))

  await migration.migrate(70, () => mintToMoneyMarketAndWallets(context, context.contracts.Dai, context.contracts.cDai.address, '10000'))

  await migration.migrate(75, async () => {
    console.log('Minting DAI to ScdMcdMigration contract and accounts')
    const tx = await context.contracts.Dai.mint(context.contracts.ScdMcdMigrationMock.address, ethers.utils.parseEther('5000000'))

    // TODO: retrieve accounts from ganache
    const accounts = [
        '0xae86df2636b14aa7b5d0eb33013f3a149a0980aa',
        '0xe40e26e2a19538136ea298f4cbd278e569ba04e3',
        '0x708c575f29bc7f020afb4ae7bf6f2eb03ef42855',
        '0x5ead33323b89a8413145c6b67d17766e2396b482',
        '0xcdfc59e0db7975e80f0c2267b9fde9d8237f8df9',
        '0x714360da4e1a8b854a5ae0f0bfd73d758139d770',
        '0x6b685e39896f2fa2ca7c29610de1fb10e3c0d4a4',
        '0xaa6cd0523d8fe988407b7d76506d585a9c1cc32d',
        '0xc7d435fc96a5bb0ece3efc47da402b6dd8e973d2',
        '0x6c0682a45b21a41ac02f99f19c34b71b8af98f63',
    ];

    accounts.map(async (account) => {
        const transaction = await context.contracts.Dai.mint(
            account,
            ethers.utils.parseEther('5000000'),
        );

        await context.provider.waitForTransaction(
            transaction.hash,
        );
    });

    await context.provider.waitForTransaction(tx.hash)

    const receipt = await context.provider.getTransactionReceipt(tx.hash)
    assert.equal(receipt.status, '1')
    console.log(`Mint tx receipt status: ${receipt.status}`)
  })

  await migration.migrate(80, () => {
    runShell(`oz create Usdc ${ozOptions} --network ${ozNetworkName} --init initialize --args '${signer.address},"Usdc","Usdc",6'`)
    context = loadContext()
  })

  await migration.migrate(85, () => {
    runShell(`oz create cUsdc ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.Usdc.address},${supplyRateMantissa}`)
    context = loadContext()
  })

  await migration.migrate(90, async () => {
    runShell(`oz create PoolUsdc ${ozOptions} --network ${ozNetworkName} --init init --args '${signer.address},${context.contracts.cUsdc.address},${feeFraction},${signer.address},${lockDuration},${cooldownDuration}'`)
    context = loadContext()
  })

  await migration.migrate(95, async () => {
    runShell(`oz create PoolUsdcToken ${ozOptions} --network ${ozNetworkName} --init init --args '"Pool Usdc","poolUsdc",[],${context.contracts.PoolUsdc.address},6'`)
    context = loadContext()
  })

  console.log({ add: context.contracts.PoolUsdcToken})
  await migration.migrate(100, async () => {
    await context.contracts.PoolUsdc.setPoolToken(context.contracts.PoolUsdcToken.address)
  })

  await migration.migrate(105, () => mintToMoneyMarketAndWallets(context, context.contracts.Usdc, context.contracts.cUsdc.address, '0.00000001'))

  await migration.migrate(120, async () => {
    runShell(`oz create DaiPod ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.PoolDai.address}`)
    context = loadContext()
  })

  await migration.migrate(130, async () => {
    runShell(`oz create UsdcPod ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.PoolUsdc.address}`)
    context = loadContext()
  })

  await migration.migrate(140, async () => {
    runShell(`oz create DonutPod ${ozOptions} --network ${ozNetworkName} --init initialize --args ${context.contracts.PoolDai.address}`)
    context = loadContext()
  })

  await migration.migrate(150, async () => {
    context = loadContext()

    const provider = context.provider;
    const signer = provider.getSigner(process.env.ADMIN_ADDRESS);
    const pool = context.contracts.PoolDai.connect(signer);

    let currentOpenDrawId = await pool.currentOpenDrawId();
    let nextDrawId = currentOpenDrawId.add('1');
    let currentCommittedDrawId = await pool.currentCommittedDrawId();

    let poolSeed = process.env.SECRET_SEED;
    let poolSaltSeed = process.env.SALT_SEED;

    if (!poolSeed || !poolSaltSeed) {
      console.error('no seed or salt defined');
      return;
    }

    console.log({
      currentCommittedDrawId: currentCommittedDrawId.toString(),
      currentOpenDrawId: currentOpenDrawId.toString(),
      nextDrawId: nextDrawId.toString(),
    });

    // if no pool is committed
    if (currentCommittedDrawId.toString() === '0') {
      console.log(chalk.red('No draw is committed!'));
    } else {
      let lastSalt = generateSecret(poolSaltSeed, currentCommittedDrawId);
      let lastSecret = generateSecret(poolSeed, currentCommittedDrawId);

      await exec(provider, pool.lockTokens());
      await exec(provider, pool.reward(lastSecret, lastSalt, overrides));

      let draw = await pool.getDraw(currentCommittedDrawId);
      let winnerBalance = await pool.balanceOf(draw.winner);

      console.log(
        chalk.green(
          `Address ${draw.winner} won ${ethers.utils.formatEther(
            draw.netWinnings,
          )} with ${ethers.utils.formatEther(winnerBalance)}`,
        ),
      );
    }

    console.log(chalk.green('Done reward.'));
  });

  await migration.migrate(160, async () => {
    context = loadContext();

    const { provider, contracts } = context;
    const signer = provider.getSigner(process.env.ADMIN_ADDRESS);
    let pool;

    pool = contracts.PoolDai.connect(signer);

    let currentOpenDrawId = await pool.currentOpenDrawId();
    let nextDrawId = currentOpenDrawId.add('1');
    let currentCommittedDrawId = await pool.currentCommittedDrawId();

    let poolSeed = process.env.SECRET_SEED;
    let poolSaltSeed = process.env.SALT_SEED;

    if (!poolSeed || !poolSaltSeed) {
        throw new Error('no seed or salt defined');
    }

    let secret = generateSecret(poolSeed, nextDrawId);
    let salt = generateSecret(poolSaltSeed, nextDrawId);
    let secretHash = generateSecretHash(secret, salt);

    console.log({
        currentCommittedDrawId: currentCommittedDrawId.toString(),
        currentOpenDrawId: currentOpenDrawId.toString(),
        nextDrawId: nextDrawId.toString(),
    });

    // if no pool is committed
    if (currentCommittedDrawId.toString() === '0') {
      await exec(provider, pool.openNextDraw(secretHash, overrides));
    } else {
      let lastSalt = generateSecret(poolSaltSeed, currentCommittedDrawId);
      let lastSecret = generateSecret(poolSeed, currentCommittedDrawId);

      if (await pool.isLocked()) {
          throw new Error('Pool is already locked');
      }
      await exec(provider, pool.lockTokens());
      await exec(
          provider,
          pool.rewardAndOpenNextDraw(secretHash, lastSecret, lastSalt, overrides),
      );

      let draw = await pool.getDraw(currentCommittedDrawId);

      let winnerBalance = await pool.balanceOf(draw.winner);

      console.log(
          chalk.green(
              `Address ${draw.winner} won ${ethers.utils.formatEther(
                  draw.netWinnings,
              )} with ${ethers.utils.formatEther(winnerBalance)}`,
          ),
      );

      console.log(chalk.green('Done reward and open.'));
    }
  });
}

console.log(chalk.yellow('Started...'))
migrate().then(() =>{
  console.log(chalk.green('Done!'))
}).catch(error => {
  console.error(`Could not migrate: ${error.message}`, error)
})
