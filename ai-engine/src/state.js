const previousRestartCounts = new Map();

export function getNewRestartCount(pod, currentRestartCount) {
    const previous = previousRestartCounts.get(pod) ?? currentRestartCount;

    previousRestartCounts.set(pod, currentRestartCount);

    return Math.max(0, currentRestartCount - previous);
}

export function clearPodState(existingPods) {
    const activePods = new Set(existingPods);

    for (const pod of previousRestartCounts.keys()) {
        if (!activePods.has(pod)) {
            previousRestartCounts.delete(pod);
        }
    }
}