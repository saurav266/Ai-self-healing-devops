import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import {
    getPreviousDeploymentRevision
} from "./kubernetes.js";
const execFileAsync = promisify(execFile);
const DRY_RUN =
    process.env.GITOPS_DRY_RUN !== "false";
const REPO_DIR =
    process.env.GITOPS_REPO_DIR ||
    "D:/Deveops_Project/Ai-self-healing-devops";

const MANIFEST =
    "kubernetes/deployment.yaml";

const IMAGE_PREFIX =
    "saurav8789/self-healing-node-app:";


async function runGit(args) {
    const { stdout, stderr } =
        await execFileAsync(
            "git",
            args,
            {
                cwd: REPO_DIR,
                windowsHide: true
            }
        );

    return {
        stdout: stdout.trim(),
        stderr: stderr.trim()
    };
}


export async function getGitOpsImage() {

    const filePath =
        `${REPO_DIR}/${MANIFEST}`;

    const content =
        await fs.readFile(
            filePath,
            "utf8"
        );

    const match =
        content.match(
            /image:\s*(saurav8789\/self-healing-node-app:\S+)/
        );

    if (!match) {
        throw new Error(
            "Application image not found in GitOps manifest"
        );
    }

    return match[1];
}


export async function rollbackGitOpsImage(
    previousTag
) {
      if (DRY_RUN) {

        const currentImage =
            await getGitOpsImage();

        const targetImage =
            `${IMAGE_PREFIX}${previousTag}`;

        return {
            status: "DRY_RUN",
            currentImage,
            targetImage,
            action: "ROLLBACK"
        };
    }

    if (!previousTag) {
        throw new Error(
            "Previous image tag is required"
        );
    }

    const filePath =
        `${REPO_DIR}/${MANIFEST}`;

    const content =
        await fs.readFile(
            filePath,
            "utf8"
        );

    const newImage =
        `${IMAGE_PREFIX}${previousTag}`;

    const updated =
        content.replace(
            /image:\s*saurav8789\/self-healing-node-app:\S+/,
            `image: ${newImage}`
        );

    if (updated === content) {
        throw new Error(
            "GitOps image was not changed"
        );
    }

    await fs.writeFile(
        filePath,
        updated,
        "utf8"
    );

    await runGit([
        "add",
        MANIFEST
    ]);

    const diff =
        await runGit([
            "diff",
            "--cached",
            "--",
            MANIFEST
        ]);

    if (!diff.stdout) {
        throw new Error(
            "No GitOps changes detected"
        );
    }

    await runGit([
        "config",
        "user.name",
        "saurav266"
    ]);

    await runGit([
        "config",
        "user.email",
        "saurav840963@gmail.com"
    ]);

    await runGit([
        "commit",
        "-m",
        `Rollback application to ${newImage}`
    ]);

    await runGit([
        "push",
        "origin",
        "main"
    ]);

    return {
        status: "ROLLBACK_COMMITTED",
        image: newImage,
        manifest: MANIFEST
    };
}

export async function rollbackToPreviousVersion() {
    const currentImage =
        await getGitOpsImage();

    const log =
        await runGit([
            "log",
            "--format=%H",
            "--",
            MANIFEST
        ]);

    const commits =
        log.stdout
            .split(/\r?\n/)
            .map((commit) => commit.trim())
            .filter(Boolean);

    if (commits.length < 2) {
        return {
            status: "SKIPPED",
            reason:
                "No previous GitOps commit found"
        };
    }

    const currentManifest =
        await fs.readFile(
            `${REPO_DIR}/${MANIFEST}`,
            "utf8"
        );

    for (const commit of commits.slice(1)) {

        const result =
            await runGit([
                "show",
                `${commit}:${MANIFEST}`
            ]);

        const previousManifest =
            result.stdout;

        const match =
            previousManifest.match(
                /image:\s*(saurav8789\/self-healing-node-app:\S+)/
            );

        if (!match) {
            continue;
        }

        const previousImage =
            match[1];

        if (
            previousManifest ===
            currentManifest
        ) {
            continue;
        }

        await fs.writeFile(
            `${REPO_DIR}/${MANIFEST}`,
            previousManifest,
            "utf8"
        );

        await runGit([
            "add",
            MANIFEST
        ]);

        const diff =
            await runGit([
                "diff",
                "--cached",
                "--",
                MANIFEST
            ]);

        if (!diff.stdout) {
            return {
                status: "SKIPPED",
                reason:
                    "No GitOps manifest changes detected"
            };
        }

        await runGit([
            "config",
            "user.name",
            "saurav266"
        ]);

        await runGit([
            "config",
            "user.email",
            "saurav840963@gmail.com"
        ]);

        await runGit([
            "commit",
            "-m",
            `Rollback application to ${previousImage}`
        ]);

        await runGit([
            "push",
            "origin",
            "main"
        ]);

        return {
            status: "ROLLBACK_REQUESTED",
            previousRevision: commit,
            currentImage,
            previousImage,
            restoredManifest: true
        };
    }

    return {
        status: "SKIPPED",
        reason:
            "No previous different GitOps manifest found"
    };
}
export async function previewRollback() {
    const previous =
        await getPreviousDeploymentRevision();

    if (!previous) {
        return {
            status: "NO_PREVIOUS_VERSION"
        };
    }

    const current =
        await getGitOpsImage();

    return {
        status: "ROLLBACK_AVAILABLE",
        currentImage: current,
        previousRevision: previous.revision,
        previousImage: previous.image
    };
}
