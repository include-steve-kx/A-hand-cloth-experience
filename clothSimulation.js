// importScripts(`${import.meta.env.BASE_URL}src/three.js`);
// importScripts(`${import.meta.env.BASE_URL}src/math.js`);
import * as THREE from './src/three.module.js';
import {clamp, remap01, remap} from './src/math.module.js';

const MASS = 0.1;
const DAMPING = 0.03;
const DRAG = 1 - DAMPING;

class Particle {
    constructor(indices, pos, bufferGeoIndex) {
        this.indices = {
            x: indices.x,
            y: indices.y,
            z: indices.z
        };
        this.position = new THREE.Vector3().copy(pos);
        this.previous = new THREE.Vector3().copy(pos);
        this.original = new THREE.Vector3().copy(pos); // forgot why this is useful. need to look at original cloth sim code again
        this.normal = new THREE.Vector3();
        this.bufferGeoIndex = bufferGeoIndex;

        this.hasCollided = false;
        this.collided = false;

        this.a = new THREE.Vector3(0, 0, 0); // acceleration
        this._mass = MASS;
        this.invMass = 1 / MASS;
        this.tmp = new THREE.Vector3();
        this.tmp2 = new THREE.Vector3();
        this.tmp3 = new THREE.Vector3();
    }

    getIndex() {
        return this.bufferGeoIndex;
    }

    _getIndices() {
        return this.indices;
    }

    addForce(force) {
        this.a.add(this.tmp2.copy(force).multiplyScalar(this.invMass));
    }

    integrate(timesq) {
        // if (this.hasCollided) return; // todo Steve: completely immobilize the collided particle. Attempt to make the system stable
        let newPos = this.tmp.subVectors(this.position, this.previous);
        newPos.multiplyScalar(DRAG).add(this.position);
        newPos.add(this.a.multiplyScalar(timesq));

        this.tmp = this.previous;
        this.previous = this.position;
        this.position = newPos;

        this.a.set(0, 0, 0);
    }

    collide(pos) { // particle collide with mesh, cannot move further. Should later change this to include bounding off force
        this.hasCollided = true;
        this.collided = true;

        // this.previous.copy(pos);
        this.position.copy(pos);

        // this.a.set(0, 0, 0);
    }
}

function xyzIndexToParticleKey(x, y, z) {
    return `(${x},${y},${z})`;
}

class Particles {
    constructor() {
        this.map = new Map();
    }

    // Insert an object with x, y, z
    push(x, y, z, particle) {
        const key = xyzIndexToParticleKey(x, y, z);
        this.map.set(key, particle);
    }

    // Get an object with x, y, z
    get(x, y, z) {
        const key = xyzIndexToParticleKey(x, y, z);
        let result = this.map.get(key);
        if (result === undefined) {
            console.error(`${key} is not in the particles map.`);
        } else {
            return result;
        }
    }

    // Check if an object with x, y, z exists
    has(x, y, z) {
        const key = xyzIndexToParticleKey(x, y, z);
        return this.map.has(key);
    }

    // Remove an object with x, y, z
    remove(x, y, z) {
        const key = xyzIndexToParticleKey(x, y, z);
        this.map.delete(key);
    }
}

let particles = new Particles();
let particlesPosArr = []; // particles position array for building buffer geometry
// todo Steve: particles UV array for building buffer geometry, currently not able to make uv's (to make a wireframe-w/o-diagonal custom shader) due to the way we use the same particle vertex position for multiple faces / indices.
//  also cannot make everything BoxGeometry & get the points from the BoxGeometry points, b/c this way each vertex would have 3 different normals, which doesn't make sense which normal to use when raycasting to mesh bvh objects. Figure out a way to solve this problem.
let particlesIndexArr = [];
let restDistance = null;
let xLength = null, yLength = null, zLength = null;
let xSegs = null, ySegs = null, zSegs = null;
let center = null;

function makeParticles(x, y, z, meshCenter, dist) {
    xLength = x;
    yLength = y;
    zLength = z;
    restDistance = dist;
    center = meshCenter;
    xSegs = Math.ceil(xLength / restDistance);
    ySegs = Math.ceil(yLength / restDistance);
    zSegs = Math.ceil(zLength / restDistance);

    let bufferGeoIndex = 0;
    const indices = {x: null, y: null, z: null};
    const pos = new THREE.Vector3();

    particles = new Particles();
    particlesPosArr = [];

    const makeParticleIndices = (xIndex, yIndex, zIndex) => {
        indices.x = xIndex;
        indices.y = yIndex;
        indices.z = zIndex;
    };
    const makeParticlePosition = (xIndex, yIndex, zIndex) => {
        pos.set(xIndex * restDistance - xLength / 2 + center.x, yIndex * restDistance - yLength / 2 + center.y, zIndex * restDistance - zLength / 2 + center.z);
        particlesPosArr.push(pos.x, pos.y, pos.z);
    };
    const makeParticleInfo = (xIndex, yIndex, zIndex) => {
        makeParticleIndices(xIndex, yIndex, zIndex);
        makeParticlePosition(xIndex, yIndex, zIndex);
    }

    for (let y = 0; y <= ySegs; y++) {
        for (let x = 0; x <= xSegs; x++) {
            makeParticleInfo(x, y, zSegs);
            particles.push(x, y, zSegs, new Particle(indices, pos, bufferGeoIndex++));
        }
    }

    return particles;
}

let constraints = [];
let lineGeo;
const lineMatYellow = new THREE.LineBasicMaterial({color: 0xffff00});

function makeConstraints() {
    constraints = [];
    let particle1 = null, particle2 = null, particle3 = null;

    // front face constraints, z === zSegs, iterate 10 x 10 times
    for (let y = 0; y < ySegs; y++) {
        for (let x = 0; x < xSegs; x++) {
            particle1 = particles.get(x, y, zSegs);
            particle2 = particles.get(x + 1, y, zSegs);
            particle3 = particles.get(x, y + 1, zSegs);
            constraints.push([particle1, particle2]);
            constraints.push([particle1, particle3]);
        }
    }
    // front face top row and right row, still need constraints
    for (let x = 0; x < xSegs; x++) {
        particle1 = particles.get(x, ySegs, zSegs);
        particle2 = particles.get(x + 1, ySegs, zSegs);
        constraints.push([particle1, particle2]);
    }
    for (let y = 0; y < ySegs; y++) {
        particle1 = particles.get(xSegs, y, zSegs);
        particle2 = particles.get(xSegs, y + 1, zSegs);
        constraints.push([particle1, particle2]);
    }

    return constraints;
}

let pins = [];

function makePins(isVisualize) {
    pins = [];
    function _makePin(x, y, z) {
        let pinParticle = particles.get(x, y, z);
        // if (isVisualize) addSphere(pinParticle.original);
        pins.push(pinParticle)
    }

    // // top 4 corners pinned down, cannot move
    // _makePin(xSegs, ySegs, zSegs);
    // _makePin(0, ySegs, zSegs);
    //
    // // bottom 4 corners pinned down
    // _makePin(xSegs, 0, zSegs);
    // _makePin(0, 0, zSegs);

    // all outer edges pinned down
    for (let x = 0; x <= xSegs; x++) {
        _makePin(x, 0, zSegs);
        _makePin(x, ySegs, zSegs);
    }
    for (let y = 0; y <= ySegs; y++) {
        _makePin(0, y, zSegs);
        _makePin(xSegs, y, zSegs);
    }
    // for (let z = 0; z <= zSegs; z++) {
    //     _makePin(0, 0, z);
    //     _makePin(xSegs, 0, z);
    //     _makePin(0, ySegs, z);
    //     _makePin(xSegs, ySegs, z);
    // }


    // top center point pinned down
    // _makePin(Math.ceil(xSegs / 2), ySegs, Math.ceil(zSegs / 2));

    // entire top face pinned down
    // for (let z = 0; z <= zSegs; z++) {
    //     for (let x = 0; x <= xSegs; x++) {
    //         _makePin(x, ySegs, z);
    //     }
    // }

    // todo Steve: can try to pin down the 8 corners of the Box while simulating in the AreaTarget mesh

    // entire bottom face pinned down
    // for (let z = 0; z <= zSegs; z++) {
    //     for (let x = 0; x <= xSegs; x++) {
    //         _makePin(x, 0, z);
    //     }
    // }
    return pins;
}

function makeBufferGeometryIndexArr() {
    particlesIndexArr = [];
    let idx0 = null, idx1 = null, idx2 = null, idx3 = null;

    // front face indices, z === zSegs, iterate 10 x 10 times
    for (let y = 0; y < ySegs; y++) {
        for (let x = 0; x < xSegs; x++) {
            idx0 = particles.get(x, y, zSegs).getIndex();
            idx1 = particles.get(x + 1, y, zSegs).getIndex();
            idx2 = particles.get(x + 1, y + 1, zSegs).getIndex();
            idx3 = particles.get(x, y + 1, zSegs).getIndex();
            particlesIndexArr.push(idx0, idx1, idx2, idx0, idx2, idx3);
        }
    }

}

let clothGeometry = null, clothMesh = null;
let normalAttri = null;
const RED = new THREE.Color(0xff0000);

// helper sphere
const sphereGeo = new THREE.SphereGeometry(5, 8, 4);
const sphereMatRed = new THREE.MeshBasicMaterial({color: RED});

function makeBufferGeometry() {
    clothGeometry = new THREE.BufferGeometry();

    makeBufferGeometryIndexArr();
    clothGeometry.setIndex(particlesIndexArr);

    let posAttri = new THREE.BufferAttribute(new Float32Array(particlesPosArr), 3);

    clothGeometry.setAttribute('position', posAttri);

    // initialize particle.normal field
    clothGeometry.computeVertexNormals();
    normalAttri = clothGeometry.attributes.normal;
    particles.map.forEach((particle) => {
        particle.normal.fromBufferAttribute(normalAttri, particle.getIndex()).negate();
    })

    let material = new THREE.MeshStandardMaterial({
        color: 0x888888,
        // transparent: true,
        // opacity: 0.5,
        wireframe: true
    });
    clothMesh = new THREE.Mesh(clothGeometry, material);
    // clothMesh.visible = false;

    // addToScene(clothMesh);
    self.postMessage({
        commandDone: 'balanceLoadDone',
        result: clothMesh.toJSON(),
    });

    return clothMesh;
}


/**********************************************************************************************************************
 ************************* init a cloth & add all the properties into a global object *********************************
 **********************************************************************************************************************/

const CLOTH_INFO = {};
let CLOTH_INTERVAL_MULTIPLIER = 30;
let CLOTH_COUNT = 0;

function initCloth(xLength, yLength, zLength, center = new THREE.Vector3(0, 0, 0), restDistance = null) {
    if (restDistance === null) {
        restDistance = Math.max(xLength, Math.max(yLength, zLength)) / 90;
    }
    // console.log(`Rest distance: ${restDistance} m`);

    let _particles = makeParticles(xLength, yLength, zLength, center, restDistance);
    let _constraints = makeConstraints();
    let _pins = makePins(true);
    let _clothMesh = makeBufferGeometry();
    let _winds = makeWind();
    let _time = Date.now();

    CLOTH_INFO[`${_time}`] = {
        particles: _particles,
        constraints: _constraints,
        pins: _pins,
        clothMesh: _clothMesh,
        winds: _winds,
        startTime: _time,
        volume: 0,
    };
    CLOTH_COUNT++;
}

// simulation & render code

let diff = new THREE.Vector3();

function satisfyConstraints(p1, p2, distance = restDistance) {
    diff.subVectors(p2.position, p1.position);
    let currentDist = diff.length();
    if (currentDist === 0) return; // prevents division by 0
    let correction = diff.multiplyScalar(1 - distance / currentDist);
    let correctionHalf = correction.multiplyScalar(0.5);

    if (p1.collided) {
        p2.position.sub(correction);
    } else if (p2.collided) {
        p1.position.add(correction);
    } else if (!p1.collided && !p2.collided) {
        p1.position.add(correctionHalf);
        p2.position.sub(correctionHalf);
    }
}

const TIMESTEP = 5 / 1000; // step size 5 / 10 seems like some good choices. Note that the step size also affects COLLIDE_THRESHOLD and GRAVITY. The bigger the step size, the bigger COLLIDE_THRESHOLD & the smaller GRAVITY needs to be, to avoid skipping some collisions
const TIMESTEP_SQ = TIMESTEP * TIMESTEP;

const GRAVITY = 9.8;
const _gravity = new THREE.Vector3(0, -GRAVITY, 0).multiplyScalar(MASS);

const WIND_STRENGTH = 0.1;
const WIND_DISTANCE_OFFSET = 1;
let winds = [];

class Wind {
    constructor(position, force) {
        this.position = position;
        this.force = force;

        this.arrowHelper = new THREE.ArrowHelper(this.force.clone().normalize(), this.position, this.force.length() * 0.5, 0x00ff00);
        // addToScene(this.arrowHelper);
    }
}

function makeWind() {
    winds = [];
    // winds.push(new Wind(new THREE.Vector3(0, -(yLength / 2 + WIND_DISTANCE_OFFSET), 0).add(center), new THREE.Vector3(0, 1, 0).multiplyScalar(WIND_STRENGTH))); // bottom
    winds.push(new Wind(new THREE.Vector3(0, 0, (zLength / 2 + WIND_DISTANCE_OFFSET)).add(center), new THREE.Vector3(0, 0, -1).multiplyScalar(WIND_STRENGTH))); // front
    // winds.push(new Wind(new THREE.Vector3((xLength / 2 + WIND_DISTANCE_OFFSET), 0, 0).add(center), new THREE.Vector3(-1, 0, 0).multiplyScalar(WIND_STRENGTH))); // right
    winds.push(new Wind(new THREE.Vector3(0, 0, -(zLength / 2 + WIND_DISTANCE_OFFSET)).add(center).add(new THREE.Vector3(0, 0, zLength)), new THREE.Vector3(0, 0, 1).multiplyScalar(WIND_STRENGTH))); // back
    // winds.push(new Wind(new THREE.Vector3(-(xLength / 2 + WIND_DISTANCE_OFFSET), 0, 0).add(center), new THREE.Vector3(1, 0, 0).multiplyScalar(WIND_STRENGTH))); // left
    // winds.push(new Wind(new THREE.Vector3(0, (yLength / 2 + WIND_DISTANCE_OFFSET), 0).add(center), new THREE.Vector3(0, -1, 0).multiplyScalar(WIND_STRENGTH))); // top

    return winds;
}

const ballRadius = 0.1;
function addTestSphere3(pos) {
    let geo = new THREE.SphereGeometry(ballRadius, 8, 4);
    let mat = new THREE.MeshBasicMaterial({color: 0xffff00});
    let sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    return sphere;
}


let handPositions = {};
/**
 * object format:
 * {
 *     0: {
 *         groupPosition: , // handOffset position
 *         jointPositions: [], // joint positions
 *     }
 * }
 * **/

// let geometry1 = new THREE.SphereGeometry(.5, 32, 16);
// let material1 = new THREE.MeshStandardMaterial({
//     color: 0xff0000,
// });
// let mesh1 = new THREE.Mesh(geometry1, material1);
// let rx = 0;
// let rxID = null;
// rxID = setInterval(() => {
//     rx += .01;
//     mesh1.position.x = Math.sin(rx) * 0.5;
//     mesh1.position.z = Math.cos(rx);
//     mesh1.updateMatrixWorld(true);
// }, 10);
// let handColliders = [mesh1];

let handColliders = [];

let handGroups2 = {}; // exactly the same as threejsScene handGroups object. This one is for colliding and threejsScene one is for displaying visuals
/**
 * object format:
 * {
 *     0: {
 *         group: , // group containing all the joints
 *         joints: [], // joint spheres
 *     }
 * }
 * **/

function updateCollisionObjects(hands) {
    // console.log(hands);

    // remove all hand sphere meshes from scene first
    for (let key of Object.keys(handPositions)) {
        self.postMessage({
            commandDone: 'removeColliderGroupFromScene',
            colliderGroup: {
                id: key,
            },
        })
    }

    handPositions = {};

    // let geometry1 = new THREE.SphereGeometry(.5, 32, 16);
    // let material1 = new THREE.MeshStandardMaterial({
    //     color: 0xff0000,
    // });
    // mesh1 = new THREE.Mesh(geometry1, material1);
    // clearInterval(rxID);
    // rxID = setInterval(() => {
    //     rx += .01;
    //     mesh1.position.x = Math.sin(rx) * 0.5;
    //     mesh1.position.z = Math.cos(rx);
    //     mesh1.updateMatrixWorld(true);
    // }, 10);
    // handColliders = [mesh1];

    handColliders = [];

    for (let [key, hand] of Object.entries(hands)) {
        handPositions[`${key}`] = {
            groupPosition: null,
            jointPositions: [],
        }

        let offset = hand.handOffset;
        handPositions[`${key}`].groupPosition = new THREE.Vector3(offset.x, offset.y, offset.z);;

        for (let i = 0; i < hand.positions.length; i++) {
            let p = hand.positions[i];
            handPositions[`${key}`].jointPositions.push(new THREE.Vector3(p.x, p.y, p.z));
        }

        self.postMessage({
            commandDone: 'addColliderGroupToScene',
            colliderGroup: {
                id: key,
                positions: handPositions[`${key}`],
            },
        })
    }

    for (let [key, hand] of Object.entries(hands)) {
        handGroups2[`${key}`] = {
            group: null,
            joints: [],
        }

        let group = new THREE.Group();
        let p = hand.handOffset;
        group.position.copy(new THREE.Vector3(p.x, p.y, p.z));
        handGroups2[`${key}`].group = group;

        for (let i = 0; i < hand.positions.length; i++) {
            let p = hand.positions[i];
            let joint = addTestSphere3(new THREE.Vector3(p.x, p.y, p.z));
            group.add(joint);
            handGroups2[`${key}`].joints.push(joint);
        }

        handColliders.push(group);
    }
}

function updateCollisionObjectsPositions(hands) {
    for (let [key, hand] of Object.entries(hands)) {
        if (handPositions[`${key}`] === undefined) return;

        let offset = hand.handOffset;
        handPositions[`${key}`].groupPosition.copy(new THREE.Vector3(offset.x, offset.y, offset.z));

        for (let i = 0; i < hand.positions.length; i++) {
            let p = hand.positions[i];
            handPositions[`${key}`].jointPositions[i].copy(new THREE.Vector3(p.x, p.y, p.z));
        }

        self.postMessage({
            commandDone: 'updateColliderGroupInScene',
            colliderGroup: {
                id: key,
                positions: handPositions[`${key}`],
            }
        })
    }

    for (let [key, hand] of Object.entries(hands)) {
        if (handGroups2[`${key}`] === undefined) return;

        let p = hand.handOffset;
        handGroups2[`${key}`].group.position.copy(new THREE.Vector3(p.x, p.y, p.z));

        for (let i = 0; i < hand.positions.length; i++) {
            let p = hand.positions[i];
            handGroups2[`${key}`].joints[i].position.copy(new THREE.Vector3(p.x, p.y, p.z));
        }
    }
}

const raycaster = new THREE.Raycaster();
raycaster.layers.enable(0);
const COLLIDE_THRESHOLD = 0.03; // 0.05 seems like a perfect threshold: too big then it skips some collision; too small it causes some particle jittering

function simulateCloth(particles, constraints, pins, winds) {

    // // apply gravity force
    // particles.map.forEach((particle) => {
    //     particle.addForce(_gravity);
    // })

    // apply wind force
    let tmp = new THREE.Vector3(), distance = null;
    particles.map.forEach((particle) => {
        winds.forEach((wind) => {
            // if (particle.hasCollided) return;

            distance = tmp.subVectors(particle.position, wind.position).length();
            particle.addForce(wind.force.clone().divideScalar(distance).multiplyScalar(1000));
        })
    })

    // verlet integration
    particles.map.forEach((particle) => {
        particle.integrate(TIMESTEP_SQ);
    })

    // relax constraints
    let constraint = null;
    for (let i = 0; i < constraints.length; i++) {
        constraint = constraints[i];
        satisfyConstraints(constraint[0], constraint[1]);
    }


    // todo Steve: visually, it looks like the glitch almost always happens at the bottom left corner of the cloth
    //  maybe it's b/c here in this code below, it does the collision check starting from bottom left corner? But maybe if I switch back to the original code from CodePen, it won't happen
    //  (b/c I see the same glitching happening with a moving sphere with this method, which didn't have an issue with the original CodePen code)
    // collision with mesh
    let particlePos = null, particleDir = null, result = null, tmpPos = new THREE.Vector3(), diff = new THREE.Vector3();
    particles.map.forEach((particle) => {
        // // using raycast doesn't seem to work with dynamic objects, always only collides with its first collided position
        // particlePos = particle.position;
        // particleDir = particle.normal;
        // tmpPos.copy(particlePos);
        // raycaster.set(tmpPos, particleDir);
        // raycaster.firstHitOnly = true;
        // if (handColliders === null || handColliders.length === 0) return;
        // result = raycaster.intersectObjects(handColliders, true);
        // if (result.length === 0 || result[0].distance > COLLIDE_THRESHOLD) { // not collided
        //     // let indices = particle._getIndices();
        //     // if (result.length !== 0 && indices.x === Math.floor(xSegs / 2) && indices.y === Math.floor(ySegs / 2) && indices.z === zSegs) console.log(result[0].distance); // todo Steve: comment out for clean debug
        //     particle.collided = false;
        //     return;
        // }
        // // console.log(result[0].distance, particle._getIndices());
        // let diff = result[0].point.clone().sub(particle.position).length();
        // particle.collide(result[0].point.sub(particleDir.clone().multiplyScalar(diff)));
        // // particle.position.copy(result[0].point.sub(particleDir.clone().multiplyScalar(diff)));

        // use sphere SDF to collide, responds with dynamic objects better
        particlePos = particle.position;
        outerForLoop: for (const handPosition of Object.values(handPositions)) {
            innerForLoop: for (let i = 0; i < handPosition.jointPositions.length; i++) {
                tmpPos.addVectors(handPosition.groupPosition, handPosition.jointPositions[i]);
                diff.subVectors(particlePos, tmpPos);
                if (diff.length() < ballRadius) {
                    // collided
                    diff.normalize().multiplyScalar(ballRadius);
                    particle.position.copy(tmpPos.clone().add(diff));
                    particle.a.set(0, 0, 0);
                    break outerForLoop;
                }
            }
        }
    })

    // // verlet integration
    // particles.map.forEach((particle) => {
    //     particle.integrate(TIMESTEP_SQ);
    // })

    // // relax constraints
    // let constraint = null;
    // for (let i = 0; i < constraints.length; i++) {
    //     constraint = constraints[i];
    //     satisfyConstraints(constraint[0], constraint[1]);
    // }

    // pin constraints
    let pinParticle = null;
    for (let i = 0; i < pins.length; i++) {
        pinParticle = pins[i];
        pinParticle.position.copy(pinParticle.original);
        pinParticle.previous.copy(pinParticle.original);
        // pinParticle.a.set(0, 0, 0);
    }
}

function renderCloth(particles, clothMesh) {
    clothGeometry = clothMesh.geometry;
    normalAttri = clothGeometry.attributes.normal;
    // change cloth buffer geometry mesh render
    particles.map.forEach((particle) => {
        let p = particle.position;
        let bufferGeoIndex = particle.getIndex();
        clothGeometry.attributes.position.setXYZ(bufferGeoIndex, p.x, p.y, p.z);
    })
    clothGeometry.attributes.position.needsUpdate = true;

    clothMesh.updateMatrixWorld();

    // update particle.normal field
    clothGeometry.computeVertexNormals();
    particles.map.forEach((particle) => {
        particle.normal.fromBufferAttribute(normalAttri, particle.getIndex()).negate();
    })
}

function balanceLoad() {
    initCloth(5, 3, 3, new THREE.Vector3(0, 0, -0.5));
    // if (CLOTH_COUNT === 0) return;
    // setInterval(() => {
    //     updateCloth();
    // }, CLOTH_INTERVAL_MULTIPLIER * CLOTH_COUNT);
}

function updateCloth() {
    if (Object.keys(CLOTH_INFO).length === 0) return;
    for (const key of Object.keys(CLOTH_INFO)) {
        const value = CLOTH_INFO[`${key}`];

        let z = value.particles.get(Math.floor(xSegs / 2), Math.floor(ySegs / 2), zSegs).position.z;
        // console.log(`%c cloth center particle z position: ${z}`, 'color: red'); // todo Steve: comment this part out for debugging purposes

        simulateCloth(value.particles, value.constraints, value.pins, value.winds);
        renderCloth(value.particles, value.clothMesh);
        self.postMessage({
            commandDone: 'updateClothDone',
            result: value.clothMesh.geometry.toJSON(),
        })
    }
}

self.onmessage = (e) => {
    let data = e.data;
    switch (data.command) {
        case 'balanceLoad':
            console.log('balance load event received in worker')
            balanceLoad();
            break;
        case 'updateCloth':
            updateCloth();
            break;
        case 'updateCollisionObjects':
            updateCollisionObjects(data.hands);
            break;
        case 'updateCollisionObjectPositions':
            updateCollisionObjectsPositions(data.hands);
            break;
        case 'clearInterval':
            clearInterval(rxID);
            break;
        case 'setInterval':
            rxID = setInterval(() => {
                rx += .1;
                // mesh1.rotation.x = rx;
                mesh1.geometry.rotateX(rx);
                mesh1.updateMatrixWorld(true);
                console.log(mesh1.matrixWorld.elements);
            }, 10);
            break;
    }
}