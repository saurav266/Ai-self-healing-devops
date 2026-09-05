import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();

// Load ~/.kube/config
kc.loadFromDefault();

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const autoscalingApi = kc.makeApiClient(k8s.AutoscalingV2Api);

const NAMESPACE = process.env.K8S_NAMESPACE || "self-healing";
const DEPLOYMENT = process.env.K8S_DEPLOYMENT || "self-healing-node-app";

export async function getPodHealth() {
    const response = await coreApi.listNamespacedPod({
        namespace: NAMESPACE,
        labelSelector: `app=${DEPLOYMENT}`
    });

    return response.items.map((pod) => {
        const containerStatuses = pod.status?.containerStatuses || [];

        const restartCount = containerStatuses.reduce(
            (total, container) => total + (container.restartCount || 0),
            0
        );

        const ready = containerStatuses.some(
            (container) => container.ready === true
        );

        return {
            pod: pod.metadata?.name,
            ready,
            restartCount,
            phase: pod.status?.phase || "Unknown"
        };
    });
}

export async function getHpaStatus() {
    const response = await autoscalingApi.readNamespacedHorizontalPodAutoscaler({
        name: "self-healing-node-hpa",
        namespace: NAMESPACE
    });

    const hpa = response;

    return {
        currentReplicas: hpa.status?.currentReplicas || 0,
        desiredReplicas: hpa.status?.desiredReplicas || 0,
        maxReplicas: hpa.spec?.maxReplicas || 0,
        minReplicas: hpa.spec?.minReplicas || 0
    };
}
export async function restartPod(podName) {
    if (!podName) {
        throw new Error("Pod name is required");
    }

    await coreApi.deleteNamespacedPod({
        name: podName,
        namespace: NAMESPACE
    });

    return {
        pod: podName,
        action: "RESTART",
        status: "DELETE_REQUESTED"
    };
}
export async function getDeploymentStatus() {
    const response =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment = response;

    return {
        desiredReplicas:
            deployment.spec?.replicas || 0,

        readyReplicas:
            deployment.status?.readyReplicas || 0,

        availableReplicas:
            deployment.status?.availableReplicas || 0,

        updatedReplicas:
            deployment.status?.updatedReplicas || 0
    };
}
export async function waitForRecovery({
    removedPod,
    timeoutMs = 60000,
    intervalMs = 5000
} = {}) {

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {

        const [
            pods,
            deployment
        ] = await Promise.all([
            getPodHealth(),
            getDeploymentStatus()
        ]);

        const originalPodExists =
            pods.some(
                pod => pod.pod === removedPod
            );

        const readyPods =
            pods.filter(
                pod => pod.ready
            );

        const recovered =
            !originalPodExists &&
            deployment.readyReplicas >=
                deployment.desiredReplicas;

        if (recovered) {

            return {
                status: "RECOVERED",

                removedPod,

                recoveryTimeSeconds:
                    Number(
                        (
                            (Date.now() - startTime) /
                            1000
                        ).toFixed(2)
                    ),

                readyReplicas:
                    deployment.readyReplicas,

                desiredReplicas:
                    deployment.desiredReplicas,

                readyPods:
                    readyPods.map(
                        pod => pod.pod
                    )
            };
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervalMs
                )
        );
    }

    const finalStatus =
        await getDeploymentStatus();

    return {
        status: "TIMEOUT",

        removedPod,

        recoveryTimeSeconds:
            Number(
                (
                    (Date.now() - startTime) /
                    1000
                ).toFixed(2)
            ),

        readyReplicas:
            finalStatus.readyReplicas,

        desiredReplicas:
            finalStatus.desiredReplicas
    };
}
export async function rollbackDeployment() {
    if (!DEPLOYMENT) {
        throw new Error("Deployment name is required");
    }

    const response =
        await appsApi.createNamespacedDeploymentRollback({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    return {
        deployment: DEPLOYMENT,
        action: "ROLLBACK",
        status: "ROLLBACK_REQUESTED",
        result: response
    };
}