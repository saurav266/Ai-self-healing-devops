import { getPodHealth } from "./kubernetes.js";
import { remediate } from "./remediator.js";

const pods = await getPodHealth();

const healthyPod = pods.find(
    (pod) => pod.ready
);

if (!healthyPod) {
    throw new Error(
        "No healthy application pod found"
    );
}

console.log(
    `[TEST] Selected pod: ${healthyPod.pod}`
);

console.log(
    "[TEST] Starting ANSIBLE_RESTART remediation..."
);

const result =
    await remediate(
        healthyPod.pod,
        "ANSIBLE_RESTART"
    );

console.log(
    "[TEST] Final result:"
);

console.dir(
    result,
    { depth: null }
);