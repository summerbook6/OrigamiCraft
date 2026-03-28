const fs = require('fs');
const path = require('path');

const srcDir = 'temp_origami_sim/js';
const filesToBundle = [
  'dynamic/GLBoilerplate.js',
  'dynamic/GPUMath.js',
  'node.js',
  'beam.js',
  'crease.js',
  'model.js',
  'dynamic/dynamicSolver.js'
];

let bundleContent = `
import { THREE } from '../three.js';
import { Shaders } from './shaders.js';

const _ = {
    each: function(obj, iterator) {
        if (Array.isArray(obj)) {
            obj.forEach(iterator);
        } else {
            for (let key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    iterator(obj[key], key);
                }
            }
        }
    }
};

// Stub out jQuery
const $ = (selector) => {
    return {
        html: () => {},
        show: () => {},
        hide: () => {},
        appendTo: () => {},
        parent: () => ({ addClass: () => {}, removeClass: () => {} }),
        modal: () => {}
    };
};

let documentShaders = Shaders;
// Mock document.getElementById for shaders
const originalGetElementById = document.getElementById.bind(document);
document.getElementById = function(id) {
    if (documentShaders[id]) {
        return { text: documentShaders[id] };
    }
    return originalGetElementById(id);
};

// Expose globals for the legacy code
let globals = {
    simType: "dynamic",
    colorMode: 'normal',
    axialStiffness: 20,
    faceStiffness: 20,
    panelStiffness: 20,
    creaseStiffness: 2,
    percentDamping: 2.0,
    calcFaceStrain: false,
    creasePercent: 0,
    integrationType: 'verlet',
    numSteps: 40,
    threeView: {
        sceneAddModel: () => {},
        startAnimation: () => {},
        pauseSimulation: () => {},
        startSimulation: () => {}
    },
    controls: {
        setDeltaT: () => {},
        updateCreasePercent: () => {}
    },
    warn: console.warn,
    noCreasePatternAvailable: () => false
};

`;

filesToBundle.forEach(file => {
    const fullPath = path.join(srcDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace globals references that need adaptation
    content = content.replace(/globals\.model\.getNodes/g, 'modelAPI.getNodes');
    content = content.replace(/globals\.model\.getEdges/g, 'modelAPI.getEdges');
    content = content.replace(/globals\.model\.getFaces/g, 'modelAPI.getFaces');
    content = content.replace(/globals\.model\.getCreases/g, 'modelAPI.getCreases');
    content = content.replace(/globals\.model\.getPositionsArray/g, 'modelAPI.getPositionsArray');
    content = content.replace(/globals\.model\.getColorsArray/g, 'modelAPI.getColorsArray');
    content = content.replace(/\.addAttribute\(/g, '.setAttribute(');
    content = content.replace(/new THREE\.LineSegments\(null,/g, 'new THREE.LineSegments(new THREE.BufferGeometry(),');
    content = content.replace(/canvas\.clientWidth\s*=\s*width;/g, 'canvas.width = width;');
    content = content.replace(/canvas\.clientHeight\s*=\s*height;/g, 'canvas.height = height;');
    content = content.replace(/console\.log\(maxTexturesInFragmentShader \+ " textures max"\);/g, '');
    content = content.replace(/console\.warn\("16 textures max"\);/g, '');
    content = content.replace(/console\.log\("16 textures max"\);/g, '');
    content = content.replace(/if \(globals\.noCreasePatternAvailable[^}]+\}/g, '');
    content = content.replace(/if \(initing\) creaseMeta\[i\*4\+2\] = crease\.getTargetTheta\(\);/g, 'creaseMeta[i*4+2] = crease.getTargetTheta();');
    content = content.replace(/mass\[4\*i\+1\] = 1;\/\/set all fixed by default/g, 'mass[4*i+1] = (nodes[i] && nodes[i].isFixed()) ? 1 : 0;');
    
    if (file === 'model.js') {
        content = content.replace(
            /\/\/\s*_nodes\[_faces\[0\]\[0\]\]\.setFixed\(true\);\s*\/\/\s*_nodes\[_faces\[0\]\[1\]\]\.setFixed\(true\);\s*\/\/\s*_nodes\[_faces\[0\]\[2\]\]\.setFixed\(true\);/g,
            `if (fold.fixedNodeIndices && fold.fixedNodeIndices.length > 0) {
            for (var i = 0; i < fold.fixedNodeIndices.length; i++) {
                if (nodes[fold.fixedNodeIndices[i]]) {
                    nodes[fold.fixedNodeIndices[i]].setFixed(true);
                }
            }
        } else if (fold.anchorFaceIndex !== undefined && fold.anchorFaceIndex < faces.length) {
            var anchorFace = faces[fold.anchorFaceIndex];
            nodes[anchorFace[0]].setFixed(true);
            nodes[anchorFace[1]].setFixed(true);
            nodes[anchorFace[2]].setFixed(true);
        }`
        );
        content = content.replace(
            /edges\.push\(new Beam\(\[nodes\[_edges\[i\]\[0\]\], nodes\[_edges\[i\]\[1\]\]\]\)\);/g,
            `var edge = new Beam([nodes[_edges[i][0]], nodes[_edges[i][1]]]);\n            edge.index = i;\n            edges.push(edge);`
        );
    }
    
    bundleContent += `\n// --- ${file} ---\n${content}\n`;
});

bundleContent += `
let modelAPI;

export class OrigamiPhysics {
    constructor() {
        this.globals = globals;
        modelAPI = initModel(globals);
        this.globals.model = modelAPI;
        this.dynamicSolver = initDynamicSolver(globals);
        this.globals.dynamicSolver = this.dynamicSolver;
    }
    
    buildModel(foldData, creaseParams) {
        modelAPI.buildModel(foldData, creaseParams);
        modelAPI.sync();
        this.dynamicSolver.syncNodesAndEdges();
    }
    
    setCreasePercent(percent) {
        this.globals.creasePercent = percent;
        this.globals.shouldChangeCreasePercent = true;
    }
    
    solve(numSteps) {
        this.dynamicSolver.solve(numSteps || this.globals.numSteps);
    }
    
    setCreaseTargetAngle(edgeIndex, angle) {
        const creases = modelAPI.getCreases();
        for (let i = 0; i < creases.length; i++) {
            if (creases[i].edge.index === edgeIndex) {
                creases[i].targetTheta = angle;
                break;
            }
        }
        // Force the crease meta to update in GPU
        this.globals.creaseMaterialHasChanged = true;
    }
    
    updateCreaseAngles(creaseParams) {
        const creases = modelAPI.getCreases();
        let changed = false;
        
        if (creases.length === creaseParams.length) {
            for (let i = 0; i < creaseParams.length; i++) {
                const angleRad = creaseParams[i][5] * Math.PI / 180;
                if (creases[i].targetTheta !== angleRad) {
                    creases[i].targetTheta = angleRad;
                    changed = true;
                }
            }
        } else {
            console.warn("updateCreaseAngles: mismatch in lengths", creases.length, creaseParams.length);
        }
        
        if (changed) {
            this.globals.creaseMaterialHasChanged = true;
        }
    }
    
    getPositions() {
        return modelAPI.getPositionsArray();
    }
    
    getIndices() {
        return modelAPI.getGeometry()?.index?.array;
    }
    
    getNodes() {
        return modelAPI.getNodes();
    }
}
`;

fs.writeFileSync('src/lib/origami-solver/OrigamiSolver.js', bundleContent);
console.log('Bundled OrigamiSolver.js successfully.');
