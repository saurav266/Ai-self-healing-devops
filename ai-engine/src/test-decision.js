import { makeDecision } from "./decision.js";

const result = makeDecision({
    cpu: 90,
    restartCount: 0,
    hpaCurrentReplicas: 3,
    hpaDesiredReplicas: 5,
    hpaMaxReplicas: 10,
    podReady: true
});

console.log(result);