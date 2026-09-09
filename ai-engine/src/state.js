const previousRestartCounts = new Map();

let rollbackInProgress = false;

let lastRollbackImage = null;

export function getNewRestartCount(
    pod,
    currentRestartCount
) {
    const previous =
        previousRestartCounts.get(pod) ??
        currentRestartCount;

    previousRestartCounts.set(
        pod,
        currentRestartCount
    );

    return Math.max(
        0,
        currentRestartCount - previous
    );
}

export function clearPodState(existingPods) {
    const activePods =
        new Set(existingPods);

    for (
        const pod of previousRestartCounts.keys()
    ) {
        if (!activePods.has(pod)) {
            previousRestartCounts.delete(pod);
        }
    }
}

export function isRollbackInProgress() {
    return rollbackInProgress;
}

export function startRollback(image) {
    if (rollbackInProgress) {
        return false;
    }

    if (
        lastRollbackImage &&
        lastRollbackImage === image
    ) {
        return false;
    }

    rollbackInProgress = true;
    lastRollbackImage = image;

    return true;
}

export function finishRollback() {
    rollbackInProgress = false;
}

export function getLastRollbackImage() {
    return lastRollbackImage;
}