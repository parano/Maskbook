import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"

const exec = promisify(execFile)

const cwd = path.join(__dirname, '..')
const hfkit = path.join(cwd, 'node_modules', '@holoflows', 'kit')

async function main() {
    if (process.argv.includes('--upgrade')) {
        await exec('yarn', ['upgrade', '@holoflows/kit'], { cwd })
    }
    await exec('yarn', ['install'], { cwd: hfkit })
    try {
        /**
         * For unknown reason, first time build will raise an exception. But if we build it twice, problem will be fixed
         *
         * src/Extension/AutomatedTabTask.ts:119:17 -
         * error TS2742: The inferred type of 'AutomatedTabTask' cannot be named
         * without a reference to '@holoflows/kit/node_modules/csstype'.
         * This is likely not portable.
         * A type annotation is necessary.
         * 119 export function AutomatedTabTask<T extends Record<string, (...args: any[]) => PromiseLike<any>>>(
         *                     ~~~~~~~~~~~~~~~~
         */
        await exec('yarn', ['build:tsc'], { cwd: hfkit })
        await exec('yarn', ['build:rollup'], { cwd: hfkit })
    } catch (e) {
        console.log('Build failed, retry one more time.', { cwd: hfkit })
        await exec('yarn', ['build:tsc'], { cwd: hfkit })
        await exec('yarn', ['build:rollup'], { cwd: hfkit })
    }
}

main()
