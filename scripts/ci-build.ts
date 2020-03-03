import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import git from "@nice-labs/git-rev"

const exec = promisify(execFile);
const cwd = path.join(__dirname, '..')
const BUILD_PATH = path.join(cwd, 'build')

async function main() {
    const branch = git.branchName().toLowerCase()
    const types = buildTypes(branch)
    console.log(`Branch: ${branch}`)
    for (const type of types) {
        if (type === 'chromium' && types.includes('base')) {
            // chromium doesn't have it's own changes yet.
            // just copying base version is acceptable
            await exec("cp", ["Maskbook.base.zip", "Maskbook.chromium.zip"], { cwd })
        }
        console.log(`Building for target: ${type}`)
        await exec('yarn', [`build:${type.toLowerCase()}`], { cwd })
        await exec('zip', ['-r', `../Maskbook.${type}.zip`, '.'], { cwd: BUILD_PATH })
        await exec('rm', ['-rf', BUILD_PATH])
    }
}

main()

function buildTypes(name: string): string[] {
    if (/full/.test(name) || name === 'master') {
        return ['base', 'chromium', 'firefox', 'gecko', 'iOS']
    } else if (/ios/.test(name)) {
        return ['iOS']
    } else if (/android|gecko/.test(name)) {
        return ['firefox', 'gecko']
    } else {
        return ['base', 'chromium', 'firefox']
    }
}
