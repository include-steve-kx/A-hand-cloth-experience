import { HandLandmarker, FilesetResolver } from "./src/task-vision.js";
import { updateHand, deleteAllHands, getHandCount, getInternals } from './threejsScene.js';

let handLandmarker = undefined;

async function createHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 4
    });
}

/********************************************************************
 // Demo 2: Continuously grab image from webcam stream and detect it.
 ********************************************************************/

const video = document.getElementById("webcam");
let isDetectionEnabled = true;

function setupEventListeners() {
    document.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
            isDetectionEnabled = !isDetectionEnabled;
            if (isDetectionEnabled) {
                console.log('%c Hand detection enabled!', 'color: green');
            } else {
                console.log('%c Hand detection disabled!', 'color: red');
            }
        }
    })
}

setupEventListeners();

// Check if webcam access is supported.
function hasGetUserMedia () {
    return !!navigator.mediaDevices?.getUserMedia;
}

if (!hasGetUserMedia()) {
    console.error("getUserMedia() is not supported by your browser");
}

function enableCam() {
    // getUsermedia parameters.
    const constraints = {
        video: true
    };

    // Activate the webcam stream.
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
}

createHandLandmarker().then(() => {
    console.log('%c Successfully created hand land-marker!', 'color: green');
    enableCam();
});

let lastVideoTime = -1;
let results = undefined;
async function predictWebcam() {
    // Call this function again to keep predicting when the browser is ready.
    window.requestAnimationFrame(predictWebcam);
    // console.log('%c ---------------', 'color: blue');

    if (!isDetectionEnabled) {
        return;
    }

    // Now let's start detecting the stream.
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = handLandmarker.detectForVideo(video, startTimeMs);
    }

    if (!results.landmarks) {
        deleteAllHands();
        return;
    }

    // results.landmarks.forEach((landmarks) => {
    //     landmarks.forEach((landmark, index) => {
    //         console.log(`For landmark #${index}, the local position is (${landmark.x}, ${landmark.y}, ${landmark.z}).`);
    //     })
    // })

    let handCount = getHandCount();

    // console.log(getInternals());
    // return;

    let scene = getInternals().scene;
    if (!scene) return;

    if (results.landmarks.length >= handCount) {
        results.landmarks.forEach((landmarks, index) => { // todo Steve: multiple hands -> one hand
            updateHand(landmarks, index, scene);
            // addHand(landmarks, index);
            // landmarks.forEach((landmark, index) => { // todo Steve: one hand -> different joints
                // console.log(`For landmark #${index}, the world position is (${landmark.x}, ${landmark.y}, ${landmark.z}).`);
            // })
        })
    } else {
        deleteAllHands();
        results.landmarks.forEach((landmarks, index) => { // todo Steve: multiple hands -> one hand
            updateHand(landmarks, index, scene);
        })
    }
}