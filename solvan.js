import sodium from 'sodium-native';
import bs58 from 'bs58';
import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'node:os';

// Constants
const base58Charset = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58AlphabetSize = 58;
const logInterval = 10000; // Log every 10,000 keys for continuous updates
const batchSize = 1000; // Number of keypairs to generate per batch

// Color definitions
const sol_teal = chalk.rgb(26, 248, 157);
const sol_lightBlue = chalk.rgb(53, 204, 193);
const sol_blue = chalk.rgb(79, 160, 210);git 
const sol_darkBlue = chalk.rgb(109, 116, 228);
const sol_lightPurple = chalk.rgb(136, 81, 243);
const sol_purple = chalk.rgb(152, 70, 255);

// Pre-allocate buffers for keypair generation
const publicKeyBuffer = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES); // 32 bytes
const secretKeyBuffer = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES); // 64 bytes

// Main thread logic
if (isMainThread) {
    const numCPUs = os.cpus().length;
    const workerStatus = new Array(numCPUs).fill({ count: 0, aps: 0, lastAddress: '', matches: 0 });

    console.log(sol_teal('\n||||||||||||||||||||||||||'));
    console.log(sol_teal('|| SOLANA VANITY ||'));
    console.log(sol_lightBlue('|| WALLET GENERATOR ||'));
    console.log(sol_lightBlue('||||||||||||||||||||||||||'));
    console.log(sol_blue('|| HOW TO USE ||'));
    console.log(sol_darkBlue('|| 1. INPUT SUFFIX ||'));
    console.log(sol_lightPurple('|| 2. CONFIRM ESTIMATE ||'));
    console.log(sol_lightPurple('|| 3. WAIT ||'));
    console.log(sol_purple('||||||||||||||||||||||||||\n'));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question(chalk.yellow('Enter your desired suffix: '), async (desiredSuffix) => {
        if (!isBase58(desiredSuffix)) {
            console.log(chalk.red(`Invalid suffix detected. Ensure your address excludes the characters '0', 'O', 'I', and 'l'.`));
            rl.close();
            return;
        }

        const suffixLength = desiredSuffix.length;
        const totalCombinations = Math.pow(base58AlphabetSize, suffixLength);
        const singleThreadKeysPerSecond = measureKeysPerSecond();
        const effectiveKeysPerSecond = singleThreadKeysPerSecond * numCPUs;
        const initialEstimatedTime = calculateRemainingTime(totalCombinations, 0, effectiveKeysPerSecond);

        console.log(chalk.rgb(82, 155, 212)(`Desired suffix: `) + chalk.white(`${desiredSuffix}`));
        console.log(chalk.rgb(82, 155, 212)(`Single-thread APS: `) + chalk.green(`~${singleThreadKeysPerSecond.toFixed(2)}`));
        console.log(chalk.rgb(82, 155, 212)(`Effective APS with ${numCPUs} threads: `) + chalk.green(`~${effectiveKeysPerSecond.toFixed(2)}`));
        console.log(chalk.rgb(82, 155, 212)(`Estimated time (50% probability): `) +
            (initialEstimatedTime.totalDays >= 1 ? chalk.red : initialEstimatedTime.totalHours > 1 ? chalk.yellow : chalk.green)
                (`${initialEstimatedTime.totalDays} days, ${initialEstimatedTime.totalHours} hrs, ${initialEstimatedTime.totalMinutes} mins, ${initialEstimatedTime.totalSeconds} secs`));

        rl.question(chalk.yellow('Proceed? (y/n): '), (answer) => {
            if (answer.toLowerCase() !== 'y') {
                console.log(chalk.red('Cancelled.'));
                rl.close();
                return;
            }

            console.log(chalk.rgb(26, 248, 157)('L') + chalk.rgb(53, 204, 193)('F') + chalk.rgb(79, 160, 210)('G') + chalk.rgb(109, 116, 228)('G') + chalk.rgb(136, 81, 243)('G') + chalk.rgb(152, 70, 255)('G'));
            startWorkers(desiredSuffix);
            rl.close();
        });
    });

    function startWorkers(desiredSuffix) {
        const workers = [];
        console.log(chalk.cyan(`Starting ${numCPUs} workers...`));

        for (let i = 0; i < numCPUs; i++) {
            workers.push(new Worker(new URL(import.meta.url), { workerData: { desiredSuffix } }));
        }

        workers.forEach((worker, index) => {
            worker.on('message', (msg) => {
                if (msg.found) {
                    workerStatus[index].matches += 1;
                    updateStatusDisplay(workerStatus);
                    console.log(chalk.green(`\nWorker ${index} found a match!`));
                    console.log(chalk.blue.green('Generated Address:'), chalk.blue(msg.publicKey));
                    console.log(chalk.blue.green('Secret Key:'), chalk.blue(msg.secretKey));
                    saveKeysToFile(msg.publicKey, msg.secretKey);
                } else if (msg.status) {
                    workerStatus[index] = {
                        count: msg.count,
                        aps: msg.aps.toFixed(2),
                        lastAddress: msg.lastAddress,
                        matches: workerStatus[index].matches
                    };
                    updateStatusDisplay(workerStatus);
                }
            });

            worker.on('error', (err) => console.error(chalk.red(`Worker ${index} error: ${err.message}`)));
            worker.on('exit', (code) => code !== 0 && console.log(chalk.red(`Worker ${index} exited with code ${code}`)));
        });
    }

    function updateStatusDisplay(statusArray) {
        console.clear();
        console.log(chalk.cyan('Worker Status:'));
        statusArray.forEach((status, i) => {
            console.log(
                chalk.yellow(`Worker ${i}: `) +
                chalk.green(`${status.count} keys, ${status.aps} APS`) +
                chalk.magenta(` | Matches: ${status.matches}`) +
                chalk.gray(` | Last Address: ${status.lastAddress.slice(0, 10)}...${status.lastAddress.slice(-10)}`)
            );
        });
    }

} else {
    // Worker thread logic
    const desiredSuffix = workerData.desiredSuffix;

    let count = 0;
    const startTime = Date.now();

    while (true) {
        // Generate a batch of keypairs
        for (let i = 0; i < batchSize; i++) {
            sodium.crypto_sign_keypair(publicKeyBuffer, secretKeyBuffer);
            const publicKeyString = bs58.encode(publicKeyBuffer);
            count++;

            if (publicKeyString.endsWith(desiredSuffix)) {
                const secretKeyString = bs58.encode(secretKeyBuffer);
                parentPort.postMessage({
                    found: true,
                    publicKey: publicKeyString,
                    secretKey: secretKeyString
                });
            }
        }

        if (count % logInterval === 0) {
            const elapsedTime = (Date.now() - startTime) / 1000;
            const aps = count / elapsedTime;
            parentPort.postMessage({
                status: true,
                count,
                aps,
                lastAddress: bs58.encode(publicKeyBuffer)
            });
        }
    }
}

// Utility functions
function isBase58(suffix) {
    return suffix.split('').every((char) => base58Charset.includes(char));
}

function measureKeysPerSecond() {
    let count = 0;
    const startTime = Date.now();
    const endTime = startTime + 1000;
    while (Date.now() < endTime) {
        sodium.crypto_sign_keypair(publicKeyBuffer, secretKeyBuffer);
        count++;
    }
    return count / ((Date.now() - startTime) / 1000);
}

function calculateRemainingTime(totalCombinations, checkedCount, keysPerSecond) {
    const remainingCombinations = Math.max((totalCombinations / 2) - checkedCount, 0);
    const totalTimeInSeconds = remainingCombinations / keysPerSecond;
    const totalDays = Math.floor(totalTimeInSeconds / 86400);
    const remainingSecondsDay = totalTimeInSeconds % 86400;
    const totalHours = Math.floor(remainingSecondsDay / 3600);
    const remainingSecondsHour = remainingSecondsDay % 3600;
    const totalMinutes = Math.floor(remainingSecondsHour / 60);
    const totalSeconds = Math.floor(remainingSecondsHour % 60);
    return { totalDays, totalHours, totalMinutes, totalSeconds };
}

function saveKeysToFile(publicKey, secretKey) {
    const filePath = 'solana_vanity_keys.json';
    const keyData = { publicKey, secretKey };
    fs.appendFile(filePath, JSON.stringify(keyData, null, 2) + '\n', 'utf8', (err) => {
        if (err) console.log(chalk.red(`Error saving keys: ${err.message}`));
        else console.log(chalk.green(`Keys saved to ${chalk.blue(filePath)}`));
    });
}