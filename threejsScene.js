import * as THREE from '/src/three.module.js';
import { OrbitControls } from "/src/OrbitControls.js";
import { remap } from "/src/math.module.js";
// import { updateCollisionObjects, updateCloth, balanceLoad } from '/clothSimulation.js';

let camera, scene, renderer;
let geometry, material, mesh;
let controls;

function setupEventListeners() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        renderer.setSize( window.innerWidth, window.innerHeight );
    })

    document.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
            clearInterval(rxID);
            worker.postMessage({command: 'clearInterval'});
        } else if (e.key === 't') {
            rxID = setInterval(() => {
                rx += .1;
                mesh.rotation.x = rx;
                mesh.updateMatrixWorld(true);
            }, 10);
            worker.postMessage({command: 'setInterval'});
        }
    })
}

let loader = new THREE.ObjectLoader();
let worker = null;
let clothMesh = null;

let handGroups = {};
/**
 * object format:
 * {
 *     0: {
 *         group: , // group containing all the joints
 *         joints: [], // joint spheres
 *     }
 * }
 * **/

function createWorker() {
    let posArr, posAttri, i, j;
    worker = new Worker('./clothSimulation.js');
    worker.postMessage({command: 'balanceLoad'});
    worker.addEventListener('message', (e) => {
        let data = e.data;
        switch (data.commandDone) {
            case 'balanceLoadDone':
                loader.parse(data.result, (mesh) => {
                    clothMesh = mesh;
                    addToScene(clothMesh);
                })
                break;
            case 'updateClothDone':
                posArr = data.result.data.attributes.position.array;
                posAttri = clothMesh.geometry.attributes.position;
                for (i = 0; i < posAttri.count; i++) {
                    j = i * 3;
                    posAttri.setXYZ(i, posArr[j], posArr[j + 1], posArr[j + 2]);
                }
                posAttri.needsUpdate = true;
                break;
            case 'addColliderGroupToScene':
                addHandGroup(data.colliderGroup.id, data.colliderGroup.positions);
                break;
            case 'updateColliderGroupInScene':
                updateHandGroup(data.colliderGroup.id, data.colliderGroup.positions);
                break;
            case 'removeColliderGroupFromScene':
                removeHandGroup(data.colliderGroup.id);
                break;
        }
    })
}

const ballRadius = 0.01;
function addTestSphere2(pos) {
    let geo = new THREE.SphereGeometry(ballRadius, 32, 16);
    let mat = new THREE.MeshBasicMaterial({color: 0xffffff});
    let sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    return sphere;
}

function addHandGroup(id, positions) {
    handGroups[`${id}`] = {
        group: null,
        joints: [],
    };

    let group = new THREE.Group();
    let p = positions.groupPosition;
    group.position.copy(new THREE.Vector3(p.x, p.y, p.z));
    handGroups[`${id}`].group = group;

    for (let i = 0; i < positions.jointPositions.length; i++) {
        let p = positions.jointPositions[i];
        let joint = addTestSphere2(new THREE.Vector3(p.x, p.y, p.z));
        // todo Steve: here we added some yellow spheres to indicate where hand joints are,
        //  but actually is redundant b/c when constructing a new Hand object, we also adds the same set of spheres to indicate where hand joints are
        //  originally I planned to only add those spheres in the Hand constructor, but later when trying to debug, I wanted to make sure clothSimulation.js
        //  actually sends & receives exactly the same position info for the hand between threejsScene.js and clothSimulation.js. Therefore I made a bunch of
        //  postMessage APIs to verify that. Now that I confirmed all the info is communicated back & forth correctly, it's actually better to turn one of the visualization off
        //  in this case, I choose to turn of the Hand constructor addTestSphere(), b/c in addHandGroup(), it uses the hand info sent from clothSimulation.js
        //  I prefer to use this info b/c it makes sure that the sphere visualization positions are the same with the positions clothSimulation.js uses for the cloth collision simulation
        group.add(joint);
        handGroups[`${id}`].joints.push(joint);
    }

    addToScene(group);
}

function updateHandGroup(id, positions) {
    if (handGroups[`${id}`] === undefined) {
        console.error('error in syncing hand groups from clothSimulation to threejsScene');
        return;
    }

    let p = positions.groupPosition;
    handGroups[`${id}`].group.position.copy(new THREE.Vector3(p.x, p.y, p.z));

    for (let i = 0; i < positions.jointPositions.length; i++) {
        let p = positions.jointPositions[i];
        handGroups[`${id}`].joints[i].position.copy(new THREE.Vector3(p.x, p.y, p.z));
    }
}

function removeHandGroup(id) {
    if (handGroups[`${id}`] === undefined) {
        console.error('error in syncing hand groups from clothSimulation to threejsScene');
        return;
    }

    handGroups[`${id}`].group.clear();
    handGroups[`${id}`].group.parent.remove(handGroups[`${id}`]);
    delete handGroups[`${id}`];
}

let rxID = null;
let rx = 0;
function init() {
    // renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    let canvas_parent_div = document.getElementById('three-js-container');
    canvas_parent_div.appendChild(renderer.domElement);

    // scene
    scene = new THREE.Scene();

    // camera
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 0, 3);

    // lighting
    const light = new THREE.AmbientLight(0x404040, 10);
    scene.add(light);
    const light2 = new THREE.PointLight(0x404040, 100, 100);
    light2.position.set(1, 2.5, 5);
    scene.add(light2);

    // mesh
    // geometry = new THREE.SphereGeometry(.5, 32, 16);
    // material = new THREE.MeshStandardMaterial({
    //     color: 0xff0000,
    // });
    // mesh = new THREE.Mesh(geometry, material);
    // rxID = setInterval(() => {
    //     rx += .01;
    //     mesh.position.x = Math.sin(rx) * 0.5;
    //     mesh.position.z = Math.cos(rx);
    //     mesh.updateMatrixWorld(true);
    // }, 10);

    // let x1, y1, z1;
    // setInterval(() => {
    //     // x1 = Math.sin(Date.now() / 70) * .1;
    //     // y1 = Math.cos(Date.now() / 80) * .1;
    //     z1 = remap(Math.sin(Date.now() / 900), -1, 1, -1, 1);
    //     // mesh.position.set(x1, y1, z1);
    //     mesh.position.set(0, 0, z1);
    //     // mesh.rotation.set(x1, y1, z1);
    //     mesh.updateMatrixWorld();
    //     // console.log(mesh1.position);
    // }, 10);

    scene.add(mesh);

    // orbit control
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = true;

    createWorker();
    setupEventListeners();
}

function addToScene(object) {
    scene.add(object);
    return object;
}

function addTestSphere(pos, parent = scene) {
    let geo = new THREE.SphereGeometry(0.1, 8, 4);
    let mat = new THREE.MeshBasicMaterial({color: 0xffffff});
    let sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    sphere.visible = false; // todo Steve: turn this visibility off b/c we have addHandGroup()
    parent.add(sphere);
    return sphere;
}

let handCount = 0;
const hands = {}; // an object of Hand instances
const tmp = new THREE.Vector3();

class Hand {
    constructor(landmarks, handIndex) { // an array, each index has .x/y/z fields, corresponding to each joint's position
        this.handIndex = handIndex;
        this.landmarks = [];
        this.handContainer = null;
        this.handOffset = new THREE.Vector3(0, 0, 0);

        this.initializeHand();

        landmarks.forEach((landmark) => {
            let newPos = new THREE.Vector3(-landmark.x, -landmark.y, -landmark.z);
            let sphere = addTestSphere(newPos, this.handContainer);
            // todo Steve: here we added some white spheres to indicate where hand joints are,
            //  but actually is redundant b/c addHandGroup() also adds the same set of spheres to indicate where hand joints are based on the info received from clothSimulation.js
            this.landmarks.push({position: newPos, mesh: sphere});
        })

        // this.handOffset.z = this.landmarks[0].position.z * 10;
        this.handContainer.position.copy(this.handOffset);
    }

    initializeHand() {
        this.handContainer = new THREE.Group();
        scene.add(this.handContainer);
    }

    updatePosition(landmarks) {
        landmarks.forEach((landmark, index) => {
            let newPos = new THREE.Vector3(-landmark.x, -landmark.y, -landmark.z);
            this.landmarks[index].position.copy(newPos);
            this.landmarks[index].mesh.position.copy(newPos);
        })

        // console.log(this.landmarks[0].position.z);
        // this.handOffset.z = this.landmarks[0].position.z * 10;
        this.handOffset.z = remap(tmp.subVectors(this.landmarks[20].position, this.landmarks[19].position).length(), 0, 0.2, -0.5, 3); // todo Steve: offset the hand a little bit based on depth info
        // console.log(this.handOffset.z) // todo Steve: comment this part out for debugging purposes
        this.handContainer.position.copy(this.handOffset);

        // todo Steve: remap the hand position to cover the entire screen
        this.landmarks.forEach((landmark, index) => {
            let newX = remap(landmark.position.x, -1, 0, -1, 1);
            let newY = remap(landmark.position.y, -1, 0, -1, 1);
            let newPos = new THREE.Vector3(newX, newY, landmark.position.z);
            landmark.position.copy(newPos);
            landmark.mesh.position.copy(newPos);

            // landmark.mesh.getWorldPosition(tmp);
            // tmp.project(camera);
            // let newX = remap(landmark.position.x, -1, 0, -1, 1);
            // let newY = remap(landmark.position.y, -1, 0, -1, 1);
            // tmp.x = newX;
            // tmp.y = newY;
            // tmp.unproject(camera);
            // let newPos = tmp.sub(this.handContainer.position);
            // landmark.position.copy(newPos);
            // landmark.mesh.position.copy(newPos);
        })
    }
}

let handsToWorker = {};
function addHand(landmarks, handIndex) {
    hands[`${handIndex}`] = new Hand(landmarks, handIndex);
    handCount++;

    // todo Steve: instead, send a message to clothSimulation web worker with new collision object info, to update them in the worker
    handsToWorker[`${handIndex}`] = {
        positions: [],
        handOffset: null,
    };
    hands[`${handIndex}`].landmarks.forEach((landmark) => {handsToWorker[`${handIndex}`].positions.push(landmark.position)});
    handsToWorker[`${handIndex}`].handOffset = hands[`${handIndex}`].handOffset;
    worker.postMessage({
        command: 'updateCollisionObjects',
        hands: handsToWorker
    })
}

function updateHand(landmarks, handIndex) {
    if (hands[`${handIndex}`] === undefined) {
        addHand(landmarks, handIndex);
        return;
    }
    hands[`${handIndex}`].updatePosition(landmarks);

    // todo Steve: instead, send a message to clothSimulation web worker with new position info, to update them in the worker
    for (let i = 0; i < hands[`${handIndex}`].landmarks.length; i++) {
        handsToWorker[`${handIndex}`].positions[i] = hands[`${handIndex}`].landmarks[i].position;
    }
    handsToWorker[`${handIndex}`].handOffset = hands[`${handIndex}`].handOffset;
    worker.postMessage({
        command: 'updateCollisionObjectPositions',
        hands: handsToWorker,
    })
}

function deleteAllHands() { // todo Steve: for now, just delete all the hands and add the hands back
    for (let [key, hand] of Object.entries(hands)) {
        hand.handContainer.clear();
        hand.handContainer.parent.remove(hand.handContainer);
        delete hands[`${key}`];
    }
    handCount = 0;

    handsToWorker = {};
    worker.postMessage({
        command: 'updateCollisionObjects',
        hands: handsToWorker
    })
}

function getHandCount() {
    return handCount;
}

function printHandsInfo() {
    for (let [key, hand] of Object.entries(hands)) {
        console.log(hand.handOffset);
    }
}

function animate() {
    requestAnimationFrame(animate);

    // printHandsInfo();

    // updateCloth();
    // instead, send a message to web worker to update the cloth information
    worker.postMessage({command: 'updateCloth'});

    renderer.render(scene, camera);
}

init();
animate();

export { updateHand, deleteAllHands, getHandCount, addToScene };