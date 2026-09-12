const previousRestartCounts = new Map();

const activeRemediations = new Set();

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

    for (const pod of previousRestartCounts.keys()) {
        if (!activePods.has(pod)) {
            previousRestartCounts.delete(pod);
        }
    }

    for (const pod of activeRemediations) {
        if (!activePods.has(pod)) {
            activeRemediations.delete(pod);
        }
    }
}

export function isRemediationInProgress(pod) {
    return activeRemediations.has(pod);
}

export function startRemediation(pod) {
    if (activeRemediations.has(pod)) {
        return false;
    }

    activeRemediations.add(pod);
    return true;
}

export function finishRemediation(pod) {
    activeRemediations.delete(pod);
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

    return true;
}

export function finishRollback(success = false, image = null) {
    rollbackInProgress = false;

    if (success && image) {
        lastRollbackImage = image;
    }
}

export function resetRollbackState() {
    rollbackInProgress = false;
    lastRollbackImage = null;
}

export function getLastRollbackImage() {
    return lastRollbackImage;
}