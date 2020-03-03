import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"

const exec = promisify(execFile)
const cwd = path.join(__dirname, '..', 'node_modules', '@holoflows', 'kit')

async function main() {
    await exec('yarn', ['install'], { cwd })
    await exec('yarn', ['build:tsc'], { cwd })
    await exec('yarn', ['build:rollup'], { cwd })
}

main()
