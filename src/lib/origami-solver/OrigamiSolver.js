
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


// --- dynamic/GLBoilerplate.js ---
//from http://webglfundamentals.org/webgl/lessons/webgl-boilerplate.html

function GLBoilerPlate(){

    /**
     * Creates and compiles a shader.
     *
     * @param {!WebGLRenderingContext} gl The WebGL Context.
     * @param {string} shaderSource The GLSL source code for the shader.
     * @param {number} shaderType The type of shader, VERTEX_SHADER or
     *     FRAGMENT_SHADER.
     * @return {!WebGLShader} The shader.
     */
    function compileShader(gl, shaderSource, shaderType) {
      // Create the shader object
      var shader = gl.createShader(shaderType);

      // Set the shader source code.
      gl.shaderSource(shader, shaderSource);

      // Compile the shader
      gl.compileShader(shader);

      // Check if it compiled
      var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      if (!success) {
        // Something went wrong during compilation; get the error
        throw "could not compile shader:" + gl.getShaderInfoLog(shader);
      }

      return shader;
    }

    /**
     * Creates a program from 2 shaders.
     *
     * @param {!WebGLRenderingContext) gl The WebGL context.
     * @param {!WebGLShader} vertexShader A vertex shader.
     * @param {!WebGLShader} fragmentShader A fragment shader.
     * @return {!WebGLProgram} A program.
     */
    function createProgram(gl, vertexShader, fragmentShader) {
      // create a program.
      var program = gl.createProgram();

      // attach the shaders.
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);

      // link the program.
      gl.linkProgram(program);

      // Check if it linked.
      var success = gl.getProgramParameter(program, gl.LINK_STATUS);
      if (!success) {
          // something went wrong with the link
          throw ("program filed to link:" + gl.getProgramInfoLog (program));
      }

      return program;
    }

    /**
     * Creates a shader from the content of a script tag.
     *
     * @param {!WebGLRenderingContext} gl The WebGL Context.
     * @param {string} scriptId The id of the script tag.
     * @param {string} opt_shaderType. The type of shader to create.
     *     If not passed in will use the type attribute from the
     *     script tag.
     * @return {!WebGLShader} A shader.
     */
    function createShaderFromSource(gl, shaderSource, shaderType) {
      return compileShader(gl, shaderSource, shaderType);
    }

    /**
     * Creates a program from 2 script tags.
     *
     * @param {!WebGLRenderingContext} gl The WebGL Context.
     * @param {string} vertexShaderId The id of the vertex shader script tag.
     * @param {string} fragmentShaderId The id of the fragment shader script tag.
     * @return {!WebGLProgram} A program
     */
    function createProgramFromSource(
        gl, vertexShader, fragmentShader) {
      var vertexShader = createShaderFromSource(gl, vertexShader, gl.VERTEX_SHADER);
      var fragmentShader = createShaderFromSource(gl, fragmentShader, gl.FRAGMENT_SHADER);
      return createProgram(gl, vertexShader, fragmentShader);
    }

    function loadVertexData(gl, program) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1,-1, 1,-1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        // look up where the vertex data needs to go.
        var positionLocation = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }

    function makeTexture(gl, width, height, type, data){

        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Set the parameters so we can render any size image.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, data);

        return texture;
    }

    return {
        createProgramFromSource: createProgramFromSource,
        loadVertexData: loadVertexData,
        makeTexture: makeTexture
    }
}

// --- dynamic/GPUMath.js ---
/**
 * Created by ghassaei on 2/24/16.
 */


function initGPUMath(){

    var glBoilerplate = GLBoilerPlate();

    var canvas = document.getElementById("gpuMathCanvas");
    var gl = canvas.getContext("webgl", {antialias:false}) || canvas.getContext("experimental-webgl", {antialias:false});
    var floatTextures = gl.getExtension('OES_texture_float');
    if (!floatTextures) {
        notSupported();
    }
    gl.disable(gl.DEPTH_TEST);

    var maxTexturesInFragmentShader = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    

    function notSupported(){
        var elm = '<div id="coverImg" ' +
                  'style="background: url(crane.gif) no-repeat center center fixed;' +
                    '-webkit-background-size: cover;' +
                    '-moz-background-size: cover;' +
                    '-o-background-size: cover;' +
                    'background-size: cover;">'+
                  '</div>';
                $(elm).appendTo($("body"));
        $("#noSupportModal").modal("show");
        $("#aboutCorner").show();
       console.warn("floating point textures are not supported on your system");
    }



    function GPUMath(){
        this.reset();
    }

    GPUMath.prototype.createProgram = function(programName, vertexShader, fragmentShader){
        var programs = this.programs;
        var program = programs[programName];
        if (program) {
            gl.useProgram(program.program);
            // console.warn("already a program with the name " + programName);
            return;
        }
        program = glBoilerplate.createProgramFromSource(gl, vertexShader, fragmentShader);
        gl.useProgram(program);
        glBoilerplate.loadVertexData(gl, program);
        programs[programName] = {
            program: program,
            uniforms: {}
        };
    };

    GPUMath.prototype.initTextureFromData = function(name, width, height, typeName, data, shouldReplace){
        var texture = this.textures[name];

        if (texture){
            if (!shouldReplace) {
                console.warn("already a texture with the name " + name);
                return;
            }
            gl.deleteTexture(texture);
        }
        texture = glBoilerplate.makeTexture(gl, width, height, gl[typeName], data);
        this.textures[name] = texture;
    };



    GPUMath.prototype.initFrameBufferForTexture = function(textureName, shouldReplace){
        var framebuffer = this.frameBuffers[textureName];
        if (framebuffer){
            if (!shouldReplace) {
                console.warn("framebuffer already exists for texture " + textureName);
                return;
            }
            gl.deleteFramebuffer(framebuffer);
        }
        var texture = this.textures[textureName];
        if (!texture){
            console.warn("texture " + textureName + " does not exist");
            return;
        }

        framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        var check = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if(check != gl.FRAMEBUFFER_COMPLETE){
            notSupported();
        }

        this.frameBuffers[textureName] = framebuffer;
    };


    GPUMath.prototype.setUniformForProgram = function(programName, name, val, type){
        if (!this.programs[programName]){
            console.warn("no program with name " + programName);
            return;
        }
        var uniforms = this.programs[programName].uniforms;
        var location = uniforms[name];
        if (!location) {
            location = gl.getUniformLocation(this.programs[programName].program, name);
            uniforms[name] = location;
        }
        if (type == "1f") gl.uniform1f(location, val);
        else if (type == "2f") gl.uniform2f(location, val[0], val[1]);
        else if (type == "3f") gl.uniform3f(location, val[0], val[1], val[2]);
        else if (type == "1i") gl.uniform1i(location, val);
        else {
            console.warn("no uniform for type " + type);
        }
    };

    GPUMath.prototype.setSize = function(width, height){
        gl.viewport(0, 0, width, height);
        canvas.width = width;
        canvas.height = height;
    };

    GPUMath.prototype.setProgram = function(programName){
        var program = this.programs[programName];
        if (program) gl.useProgram(program.program);
    };

    GPUMath.prototype.step = function(programName, inputTextures, outputTexture, time){

        gl.useProgram(this.programs[programName].program);
        if (time) this.setUniformForProgram(programName, "u_time", time, "1f");
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffers[outputTexture]);
        for (var i=0;i<inputTextures.length;i++){
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[inputTextures[i]]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);//draw to framebuffer
    };

    GPUMath.prototype.swapTextures = function(texture1Name, texture2Name){
        var temp = this.textures[texture1Name];
        this.textures[texture1Name] = this.textures[texture2Name];
        this.textures[texture2Name] = temp;
        temp = this.frameBuffers[texture1Name];
        this.frameBuffers[texture1Name] = this.frameBuffers[texture2Name];
        this.frameBuffers[texture2Name] = temp;
    };

    GPUMath.prototype.swap3Textures = function(texture1Name, texture2Name, texture3Name){
        var temp = this.textures[texture3Name];
        this.textures[texture3Name] = this.textures[texture2Name];
        this.textures[texture2Name] = this.textures[texture1Name];
        this.textures[texture1Name] = temp;
        temp = this.frameBuffers[texture3Name];
        this.frameBuffers[texture3Name] = this.frameBuffers[texture2Name];
        this.frameBuffers[texture2Name] = this.frameBuffers[texture1Name];
        this.frameBuffers[texture1Name] = temp;
    };

    GPUMath.prototype.readyToRead = function(){
        return gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE;
    };

    GPUMath.prototype.readPixels = function(xMin, yMin, width, height, array){
        gl.readPixels(xMin, yMin, width, height, gl.RGBA, gl.UNSIGNED_BYTE, array);
    };

    GPUMath.prototype.reset = function(){
        this.programs = {};
        this.frameBuffers = {};
        this.textures = {};
        this.index = 0;
    };

    return new GPUMath;
}

// --- node.js ---
/**
 * Created by ghassaei on 9/16/16.
 */

var nodeMaterial = new THREE.MeshBasicMaterial({color: 0x000000, side:THREE.DoubleSide});
var transparentMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, opacity:0.5, transparent:true});
var transparentVRMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, opacity:0.8, transparent:true});

var nodeGeo = new THREE.SphereGeometry(0.02,20);

function Node(position, index){

    this.type = "node";
    this.index = index;
    this._originalPosition = position.clone();

    this.beams = [];
    this.creases = [];
    this.invCreases = [];
    this.externalForce = null;
    this.fixed = false;

    // this.render(new THREE.Vector3(0,0,0));
}

Node.prototype.setFixed = function(fixed){
    this.fixed = fixed;
    // if (fixed) {
    //     this.object3D.material = nodeMaterialFixed;
    //     this.object3D.geometry = nodeFixedGeo;
    //     if (this.externalForce) this.externalForce.hide();
    // }
    // else {
    //     this.object3D.material = nodeMaterial;
    //     this.object3D.geometry = nodeGeo;
    //     if (this.externalForce) this.externalForce.show();
    // }
};

Node.prototype.isFixed = function(){
    return this.fixed;
};




//forces

Node.prototype.addExternalForce = function(force){
    // this.externalForce = force;
    // var position = this.getOriginalPosition();
    // this.externalForce.setOrigin(position);
    // if (this.fixed) this.externalForce.hide();
};

Node.prototype.getExternalForce = function(){
    if (!this.externalForce) return new THREE.Vector3(0,0,0);
    return this.externalForce.getForce();
};

Node.prototype.addCrease = function(crease){
    this.creases.push(crease);
};

Node.prototype.removeCrease = function(crease){
    if (this.creases === null) return;
    var index = this.creases.indexOf(crease);
    if (index>=0) this.creases.splice(index, 1);
};

Node.prototype.addInvCrease = function(crease){
    this.invCreases.push(crease);
};

Node.prototype.removeInvCrease = function(crease){
    if (this.invCreases === null) return;
    var index = this.invCreases.indexOf(crease);
    if (index>=0) this.invCreases.splice(index, 1);
};


Node.prototype.addBeam = function(beam){
    this.beams.push(beam);
};

Node.prototype.removeBeam = function(beam){
    if (this.beams === null) return;
    var index = this.beams.indexOf(beam);
    if (index>=0) this.beams.splice(index, 1);
};

Node.prototype.getBeams = function(){
    return this.beams;
};

Node.prototype.numBeams = function(){
    return this.beams.length;
};

Node.prototype.isConnectedTo = function(node){
    for (var i=0;i<this.beams.length;i++){
        if (this.beams[i].getOtherNode(this) == node) return true;
    }
    return false;
};

Node.prototype.numCreases = function(){
    return this.creases.length;
};

Node.prototype.getIndex = function(){//in nodes array
    return this.index;
};

Node.prototype.getObject3D = function(){
    return this.object3D;
};

// Node.prototype.highlight = function(){
//     this.object3D.material = nodeMaterialHighlight;
// };
//
// Node.prototype.unhighlight = function(){
//     if (!this.object3D) return;
//     if (this.fixed) {
//         this.object3D.material = nodeMaterialFixed;
//     }
//     else {
//         this.object3D.material = nodeMaterial;
//     }
// };

Node.prototype.setTransparent = function(){
    if (!this.object3D){
        this.object3D = new THREE.Mesh(nodeGeo, nodeMaterial);
        this.object3D.visible = false;
    }
    this.object3D.material = transparentMaterial;
};

Node.prototype.setTransparentVR = function(){
    if (!this.object3D){
        this.object3D = new THREE.Mesh(nodeGeo, nodeMaterial);
        this.object3D.visible = false;
    }
    this.object3D.material = transparentVRMaterial;
    this.object3D.scale.set(0.4, 0.4, 0.4);
};

// Node.prototype.hide = function(){
//     this.object3D.visible = false;
// };

// Node.prototype.render = function(position){
    // if (this.fixed) return;
    // position.add(this.getOriginalPosition());
    // console.log(position);
    // this.object3D.position.set(position.x, position.y, position.z);
    // return position;
// };
// Node.prototype.renderDelta = function(delta){
//     // if (this.fixed) return;
//     this.object3D.position.add(delta);
//     return this.object3D.position;
// };

// Node.prototype.renderChange = function(change){
//     this.object3D.position.add(change);
// };








//dynamic solve

Node.prototype.getOriginalPosition = function(){
    return this._originalPosition.clone();
};
Node.prototype.setOriginalPosition = function(x, y, z){
    this._originalPosition.set(x, y, z);
};

Node.prototype.getPosition = function(){
    var positions = modelAPI.getPositionsArray();
    var i = this.getIndex();
    return new THREE.Vector3(positions[3*i], positions[3*i+1], positions[3*i+2]);
};

Node.prototype.moveManually = function(position){
    var positions = modelAPI.getPositionsArray();
    var i = this.getIndex();
    positions[3*i] = position.x;
    positions[3*i+1] = position.y;
    positions[3*i+2] = position.z;
};

Node.prototype.getRelativePosition = function(){
    return this.getPosition().sub(this._originalPosition);
};

Node.prototype.getSimMass = function(){
    return 1;
};





//deallocate

Node.prototype.destroy = function(){
    //object3D is removed in outer scope
    this.object3D = null;
    this.beams = null;
    this.creases = null;
    this.invCreases = null;
    this.externalForce = null;
};

// --- beam.js ---
/**
 * Created by ghassaei on 9/16/16.
 */

// var beamMaterialHighlight = new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 1});
// var beamMaterial = new THREE.LineBasicMaterial({color: 0x000000, linewidth: 1});

function Beam(nodes){

    this.type = "beam";

    nodes[0].addBeam(this);
    nodes[1].addBeam(this);
    this.vertices = [nodes[0]._originalPosition, nodes[1]._originalPosition];
    this.nodes = nodes;

    // var lineGeometry = new THREE.Geometry();
    // lineGeometry.dynamic = true;
    // lineGeometry.vertices = this.vertices;

    // this.object3D = new THREE.Line(lineGeometry, beamMaterial);

    this.originalLength = this.getLength();
}

// Beam.prototype.highlight = function(){
//     this.object3D.material = beamMaterialHighlight;
// };
//
// Beam.prototype.unhighlight = function(){
//     this.object3D.material = beamMaterial;
// };

Beam.prototype.getLength = function(){
    return this.getVector().length();
};
Beam.prototype.getOriginalLength = function(){
    return this.originalLength;
};
Beam.prototype.recalcOriginalLength = function(){
    this.originalLength = this.getVector().length();
};

Beam.prototype.isFixed = function(){
    return this.nodes[0].fixed && this.nodes[1].fixed;
};

Beam.prototype.getVector = function(fromNode){
    if (fromNode == this.nodes[1]) return this.vertices[0].clone().sub(this.vertices[1]);
    return this.vertices[1].clone().sub(this.vertices[0]);
};

// Beam.prototype.setVisibility = function(state){
//     this.object3D.visible = state;
// };



//dynamic solve

Beam.prototype.getK = function(){
    return globals.axialStiffness/this.getLength();
};

Beam.prototype.getD = function(){
    return globals.percentDamping*2*Math.sqrt(this.getK()*this.getMinMass());
};

Beam.prototype.getNaturalFrequency = function(){
    return Math.sqrt(this.getK()/this.getMinMass());
};

Beam.prototype.getMinMass = function(){
    var minMass = this.nodes[0].getSimMass();
    if (this.nodes[1].getSimMass()<minMass) minMass = this.nodes[1].getSimMass();
    return minMass;
};

Beam.prototype.getOtherNode = function(node){
    if (this.nodes[0] == node) return this.nodes[1];
    return this.nodes[0];
};

// var valleyColor = new THREE.LineBasicMaterial({color:0x0000ff});
// var mtnColor = new THREE.LineBasicMaterial({color:0xff0000});

// Beam.prototype.setMountain = function(){
//     this.object3D.material = mtnColor;
// };
//
// Beam.prototype.setValley = function(){
//     this.object3D.material = valleyColor;
// };


//render

// Beam.prototype.getObject3D = function(){
//     return this.object3D;
// };

// Beam.prototype.render = function(shouldComputeLineDistance){
//     this.object3D.geometry.verticesNeedUpdate = true;
//     this.object3D.geometry.computeBoundingSphere();
//     if (shouldComputeLineDistance) this.object3D.geometry.computeLineDistances();//for dashed lines
// };




//deallocate

Beam.prototype.destroy = function(){
    var self = this;
    _.each(this.nodes, function(node){
        node.removeBeam(self);
    });
    this.vertices = null;
    // this.object3D = null;
    this.nodes = null;
};

// --- crease.js ---
/**
 * Created by amandaghassaei on 2/25/17.
 */

function Crease(edge, face1Index, face2Index, targetTheta, type, node1, node2, index){
    //type = 0 panel, 1 crease

    //face1 corresponds to node1, face2 to node2
    this.edge = edge;
    for (var i=0;i<edge.nodes.length;i++){
        edge.nodes[i].addInvCrease(this);
    }
    this.face1Index = face1Index;//todo this is useless
    this.face2Index = face2Index;
    this.targetTheta = targetTheta;
    this.type = type;
    this.node1 = node1;//node at vertex of face 1
    this.node2 = node2;//node at vertex of face 2
    this.index = index;
    node1.addCrease(this);
    node2.addCrease(this);
}

Crease.prototype.getLength = function(){
    return this.edge.getLength();
};

Crease.prototype.getVector = function(fromNode){
    return this.edge.getVector(fromNode);
};

Crease.prototype.getNormal1Index = function(){
    return this.face1Index;
};

Crease.prototype.getNormal2Index = function(){
    return this.face2Index;
};

Crease.prototype.getTargetTheta = function(){
    return this.targetTheta;
};

Crease.prototype.getK = function(){
    var length = this.getLength();
    if (this.type == 0) return globals.panelStiffness*length;
    return globals.creaseStiffness*length;
};

Crease.prototype.getD = function(){
    return globals.percentDamping*2*Math.sqrt(this.getK());
};

Crease.prototype.getIndex = function(){
    return this.index;
};

Crease.prototype.getLengthToNode1 = function(){
    return this.getLengthTo(this.node1);
};

Crease.prototype.getLengthToNode2 = function(){
    return this.getLengthTo(this.node2);
};

Crease.prototype.getCoef1 = function(edgeNode){
    return this.getCoef(this.node1, edgeNode);
};
Crease.prototype.getCoef2 = function(edgeNode){
    return this.getCoef(this.node2, edgeNode);
};

Crease.prototype.getCoef = function(node, edgeNode){
    var vector1 = this.getVector(edgeNode);
    var creaseLength = vector1.length();
    vector1.normalize();
    var nodePosition = node.getOriginalPosition();
    var vector2 = nodePosition.sub(edgeNode.getOriginalPosition());
    var projLength = vector1.dot(vector2);
    var length = Math.sqrt(vector2.lengthSq()-projLength*projLength);
    if (length <= 0.0) {
        console.warn("bad moment arm");
        length = 0.001;
    }
    return (1-projLength/creaseLength);
};

Crease.prototype.getLengthTo = function(node){
    var vector1 = this.getVector().normalize();
    var nodePosition = node.getOriginalPosition();
    var vector2 = nodePosition.sub(this.edge.nodes[1].getOriginalPosition());
    var projLength = vector1.dot(vector2);
    var length = Math.sqrt(vector2.lengthSq()-projLength*projLength);
    if (length <= 0.0) {
        console.warn("bad moment arm");
        length = 0.001;
    }
    return length;
};

Crease.prototype.getNodeIndex = function(node){
    if (node == this.node1) return 1;
    else if (node == this.node2) return 2;
    else if (node == this.edge.nodes[0]) return 3;
    else if (node == this.edge.nodes[1]) return 4;
    console.log("unknown node type");
    return 0;
};

Crease.prototype.setVisibility = function(){
    var vis = false;
    if (this.type==0) vis = globals.panelsVisible;
    else {
        vis = (this.targetTheta>0 && globals.mtnsVisible) || (this.targetTheta<0 && globals.valleysVisible);
    }
    this.edge.setVisibility(vis);
};

Crease.prototype.destroy = function(){
    this.node1.removeCrease(this);
    this.node2.removeCrease(this);
    if (this.edge && this.edge.nodes){
        for (var i=0;i<this.edge.nodes.length;i++){
            this.edge.nodes[i].removeInvCrease(this);
        }
    }
    this.edge = null;
    this.face1Index = null;
    this.face2Index = null;
    this.targetTheta = null;
    this.type = null;
    this.node1 = null;
    this.node2 = null;
    this.index = null;
};

// --- model.js ---
/**
 * Created by amandaghassaei on 2/24/17.
 */

//model updates object3d geometry and materials

function initModel(globals){

    var material, material2, geometry;
    var frontside = new THREE.Mesh();//front face of mesh
    var backside = new THREE.Mesh();//back face of mesh (different color)
    backside.visible = false;

    var lineMaterial = new THREE.LineBasicMaterial({color: 0x000000, linewidth: 1});
    var hingeLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    var mountainLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    var valleyLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    var cutLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    var facetLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    var borderLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);

    var lines = {
        U: hingeLines,
        M: mountainLines,
        V: valleyLines,
        C: cutLines,
        F: facetLines,
        B: borderLines
    };

    clearGeometries();
    setMeshMaterial();

    function clearGeometries(){

        if (geometry) {
            frontside.geometry = null;
            backside.geometry = null;
            geometry.dispose();
        }

        geometry = new THREE.BufferGeometry();
        frontside.geometry = geometry;
        backside.geometry = geometry;
        // geometry.verticesNeedUpdate = true;
        geometry.dynamic = true;

        _.each(lines, function(line){
            var lineGeometry = line.geometry;
            if (lineGeometry) {
                line.geometry = null;
                lineGeometry.dispose();
            }

            lineGeometry = new THREE.BufferGeometry();
            line.geometry = lineGeometry;
            // lineGeometry.verticesNeedUpdate = true;
            lineGeometry.dynamic = true;
        });
    }

    globals.threeView.sceneAddModel(frontside);
    globals.threeView.sceneAddModel(backside);
    _.each(lines, function(line){
        globals.threeView.sceneAddModel(line);
    });

    var positions;//place to store buffer geo vertex data
    var colors;//place to store buffer geo vertex colors
    var indices;
    var nodes = [];
    var faces = [];
    var edges = [];
    var creases = [];
    var vertices = [];//indexed vertices array
    var fold, creaseParams;

    var nextCreaseParams, nextFold;//todo only nextFold, nextCreases?

    var inited = false;

    function setMeshMaterial() {
        var polygonOffset = 0.5;
        if (globals.colorMode == "normal") {
            material = new THREE.MeshNormalMaterial({
                flatShading:true,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: polygonOffset, // positive value pushes polygon further away
                polygonOffsetUnits: 1
            });
            backside.visible = false;
        } else if (globals.colorMode == "axialStrain"){
            material = new THREE.MeshBasicMaterial({
                vertexColors: THREE.VertexColors, side:THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: polygonOffset, // positive value pushes polygon further away
                polygonOffsetUnits: 1
            });
            backside.visible = false;
            if (!globals.threeView.simulationRunning) {
                getSolver().render();
                setGeoUpdates();
            }
        } else {
            material = new THREE.MeshPhongMaterial({
                flatShading:true,
                side:THREE.FrontSide,
                polygonOffset: true,
                polygonOffsetFactor: polygonOffset, // positive value pushes polygon further away
                polygonOffsetUnits: 1
            });
            material2 = new THREE.MeshPhongMaterial({
                flatShading:true,
                side:THREE.BackSide,
                polygonOffset: true,
                polygonOffsetFactor: polygonOffset, // positive value pushes polygon further away
                polygonOffsetUnits: 1
            });
            material.color.setStyle( "#" + globals.color1);
            material2.color.setStyle( "#" + globals.color2);
            backside.visible = true;
        }
        frontside.material = material;
        backside.material = material2;
    }

    function updateEdgeVisibility(){
        mountainLines.visible = globals.edgesVisible && globals.mtnsVisible;
        valleyLines.visible = globals.edgesVisible && globals.valleysVisible;
        facetLines.visible = globals.edgesVisible && globals.panelsVisible;
        hingeLines.visible = globals.edgesVisible && globals.passiveEdgesVisible;
        borderLines.visible = globals.edgesVisible && globals.boundaryEdgesVisible;
        cutLines.visible = false;
    }

    function updateMeshVisibility(){
        frontside.visible = globals.meshVisible;
        backside.visible = globals.colorMode == "color" && globals.meshVisible;
    }

    function getGeometry(){
        return geometry;
    }

    function getMesh(){
        return [frontside, backside];
    }

    function getPositionsArray(){
        return positions;
    }

    function getColorsArray(){
        return colors;
    }

    function pause(){
        globals.threeView.pauseSimulation();
    }

    function resume(){
        globals.threeView.startSimulation();
    }

    function reset(){
        getSolver().reset();
        setGeoUpdates();
    }

    function step(numSteps){
        getSolver().solve(numSteps);
        setGeoUpdates();
    }

    function setGeoUpdates(){
        geometry.attributes.position.needsUpdate = true;
        if (globals.colorMode == "axialStrain") geometry.attributes.color.needsUpdate = true;
        if (globals.userInteractionEnabled || globals.vrEnabled) geometry.computeBoundingBox();
    }

    function startSolver(){
        globals.threeView.startAnimation();
    }

    function getSolver(){
        if (globals.simType == "dynamic") return globals.dynamicSolver;
        else if (globals.simType == "static") return globals.staticSolver;
        return globals.rigidSolver;
    }




    function buildModel(fold, creaseParams){

        if (fold.vertices_coords.length == 0) {
            globals.warn("No geometry found.");
            return;
        }
        if (fold.faces_vertices.length == 0) {
            globals.warn("No faces found, try adjusting import vertex merge tolerance.");
            return;
        }
        if (fold.edges_vertices.length == 0) {
            globals.warn("No edges found.");
            return;
        }

        nextFold = fold;
        nextCreaseParams = creaseParams;

        globals.needsSync = true;
        globals.simNeedsSync = true;

        if (!inited) {
            startSolver();//start animation loop
            inited = true;
        }
    }



    function sync(){

        for (var i=0;i<nodes.length;i++){
            nodes[i].destroy();
        }

        for (var i=0;i<edges.length;i++){
            edges[i].destroy();
        }

        for (var i=0;i<creases.length;i++){
            creases[i].destroy();
        }

        fold = nextFold;
        nodes = [];
        edges = [];
        faces = fold.faces_vertices;
        creases = [];
        creaseParams = nextCreaseParams;
        var _edges = fold.edges_vertices;

        var _vertices = [];
        for (var i=0;i<fold.vertices_coords.length;i++){
            var vertex = fold.vertices_coords[i];
            _vertices.push(new THREE.Vector3(vertex[0], vertex[1], vertex[2]));
        }

        for (var i=0;i<_vertices.length;i++){
            nodes.push(new Node(_vertices[i].clone(), nodes.length));
        }
        if (fold.fixedNodeIndices && fold.fixedNodeIndices.length > 0) {
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
        }

        for (var i=0;i<_edges.length;i++) {
            var edge = new Beam([nodes[_edges[i][0]], nodes[_edges[i][1]]]);
            edge.index = i;
            edges.push(edge);
        }

        for (var i=0;i<creaseParams.length;i++) {//allCreaseParams.length
            var _creaseParams = creaseParams[i];//face1Ind, vert1Ind, face2Ind, ver2Ind, edgeInd, angle
            var type = _creaseParams[5]!=0 ? 1:0;
            //edge, face1Index, face2Index, targetTheta, type, node1, node2, index
            creases.push(new Crease(
                edges[_creaseParams[4]],
                _creaseParams[0],
                _creaseParams[2],
                _creaseParams[5] * Math.PI / 180,  // convert back to radians for the GPU math
                type,
                nodes[_creaseParams[1]],
                nodes[_creaseParams[3]],
                creases.length));
        }

        vertices = [];
        for (var i=0;i<nodes.length;i++){
            vertices.push(nodes[i].getOriginalPosition());
        }

        

        positions = new Float32Array(vertices.length*3);
        colors = new Float32Array(vertices.length*3);
        indices = new Uint16Array(faces.length*3);

        for (var i=0;i<vertices.length;i++){
            positions[3*i] = vertices[i].x;
            positions[3*i+1] = vertices[i].y;
            positions[3*i+2] = vertices[i].z;
        }
        for (var i=0;i<faces.length;i++){
            var face = faces[i];
            indices[3*i] = face[0];
            indices[3*i+1] = face[1];
            indices[3*i+2] = face[2];
        }

        clearGeometries();

        var positionsAttribute = new THREE.BufferAttribute(positions, 3);

        var lineIndices = {
            U: [],
            V: [],
            M: [],
            B: [],
            F: [],
            C: []
        };
        for (var i=0;i<fold.edges_assignment.length;i++){
            var edge = fold.edges_vertices[i];
            var assignment = fold.edges_assignment[i];
            lineIndices[assignment].push(edge[0]);
            lineIndices[assignment].push(edge[1]);
        }
        _.each(lines, function(line, key){
            var indicesArray = lineIndices[key];
            var indices = new Uint16Array(indicesArray.length);
            for (var i=0;i<indicesArray.length;i++){
                indices[i] = indicesArray[i];
            }
            lines[key].geometry.setAttribute('position', positionsAttribute);
            lines[key].geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            // lines[key].geometry.attributes.position.needsUpdate = true;
            // lines[key].geometry.index.needsUpdate = true;
            lines[key].geometry.computeBoundingBox();
            lines[key].geometry.computeBoundingSphere();
            lines[key].geometry.center();
        });

        geometry.setAttribute('position', positionsAttribute);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        // geometry.attributes.position.needsUpdate = true;
        // geometry.index.needsUpdate = true;
        // geometry.verticesNeedUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.center();

        var scale = 1/geometry.boundingSphere.radius;
        globals.scale = scale;

        //scale geometry
        for (var i=0;i<positions.length;i++){
            positions[i] *= scale;
        }
        for (var i=0;i<vertices.length;i++){
            vertices[i].multiplyScalar(scale);
        }

        //update vertices and edges
        for (var i=0;i<vertices.length;i++){
            nodes[i].setOriginalPosition(positions[3*i], positions[3*i+1], positions[3*i+2]);
        }
        for (var i=0;i<edges.length;i++){
            edges[i].recalcOriginalLength();
        }

        updateEdgeVisibility();
        updateMeshVisibility();

        syncSolver();

        globals.needsSync = false;
        if (!globals.simulationRunning) reset();
    }

    function syncSolver(){
        getSolver().syncNodesAndEdges();
        globals.simNeedsSync = false;
    }

    function getNodes(){
        return nodes;
    }

    function getEdges(){
        return edges;
    }

    function getFaces(){
        return faces;
    }

    function getCreases(){
        return creases;
    }

    function getDimensions(){
        geometry.computeBoundingBox();
        return geometry.boundingBox.max.clone().sub(geometry.boundingBox.min);
    }

    return {
        pause: pause,
        resume: resume,
        reset: reset,
        step: step,

        getNodes: getNodes,
        getEdges: getEdges,
        getFaces: getFaces,
        getCreases: getCreases,
        getGeometry: getGeometry,//for save stl
        getPositionsArray: getPositionsArray,
        getColorsArray: getColorsArray,
        getMesh: getMesh,

        buildModel: buildModel,//load new model
        sync: sync,//update geometry to new model
        syncSolver: syncSolver,//update solver params

        //rendering
        setMeshMaterial: setMeshMaterial,
        updateEdgeVisibility: updateEdgeVisibility,
        updateMeshVisibility: updateMeshVisibility,

        getDimensions: getDimensions//for save stl
    }
}

// --- dynamic/dynamicSolver.js ---
/**
 * Created by ghassaei on 10/7/16.
 */

function initDynamicSolver(globals){

    globals.gpuMath = initGPUMath();

    var nodes;
    var edges;
    var faces;
    var creases;
    var positions;
    var colors;

    var originalPosition;
    var position;
    var lastPosition;
    var lastLastPosition;//for verlet integration
    var velocity;
    var lastVelocity;
    var externalForces;
    var mass;
    var meta;//[beamMetaIndex, numBeams, nodeCreaseMetaIndex, numCreases]
    var meta2;//[nodeFaceMetaIndex, numFaces]
    var beamMeta;//[K, D, length, otherNodeIndex]

    var normals;
    var faceVertexIndices;//[a,b,c] textureDimFaces
    var nominalTriangles;//[angleA, angleB, angleC]
    var nodeFaceMeta;//[faceIndex, a, b, c] textureNodeFaces
    var creaseMeta;//[k, d, targetTheta, -] textureDimCreases
    var creaseMeta2;//[node1Index, node2Index, node3index, node4index]//nodes 1 and 2 are opposite crease, 3 and 4 are on crease, textureDimCreases
    var nodeCreaseMeta;//[creaseIndex (thetaIndex), nodeIndex (1/2/3/4), -, -] textureDimNodeCreases
    var creaseGeo;//[h1, h2, coef1, coef2]
    var creaseVectors;//indices of crease nodes
    var theta;//[theta, w, normalIndex1, normalIndex2]
    var lastTheta;//[theta, w, normalIndex1, normalIndex2]

    function syncNodesAndEdges(){
        nodes = modelAPI.getNodes();
        edges = modelAPI.getEdges();
        faces = modelAPI.getFaces();
        creases = modelAPI.getCreases();

        positions = modelAPI.getPositionsArray();
        colors = modelAPI.getColorsArray();

        initTypedArrays();
        initTexturesAndPrograms(globals.gpuMath);
        setSolveParams();
    }

    var programsInited = false;//flag for initial setup

    var textureDim = 0;
    var textureDimEdges = 0;
    var textureDimFaces = 0;
    var textureDimCreases = 0;
    var textureDimNodeCreases = 0;
    var textureDimNodeFaces = 0;

    function reset(){
        globals.gpuMath.step("zeroTexture", [], "u_position");
        globals.gpuMath.step("zeroTexture", [], "u_lastPosition");
        globals.gpuMath.step("zeroTexture", [], "u_lastLastPosition");
        globals.gpuMath.step("zeroTexture", [], "u_velocity");
        globals.gpuMath.step("zeroTexture", [], "u_lastVelocity");
        globals.gpuMath.step("zeroThetaTexture", ["u_lastTheta"], "u_theta");
        globals.gpuMath.step("zeroThetaTexture", ["u_theta"], "u_lastTheta");
        render();
    }

    function solve(_numSteps){

        if (globals.shouldAnimateFoldPercent){
            globals.creasePercent = globals.videoAnimator.nextFoldAngle(0);
            globals.controls.updateCreasePercent();
            setCreasePercent(globals.creasePercent);
            globals.shouldChangeCreasePercent = true;
        }

        if (globals.forceHasChanged) {
            updateExternalForces();
            globals.forceHasChanged = false;
        }
        if (globals.fixedHasChanged) {
            updateFixed();
            globals.fixedHasChanged = false;
        }
        if (globals.nodePositionHasChanged) {
            updateLastPosition();
            globals.nodePositionHasChanged = false;
        }
        if (globals.creaseMaterialHasChanged) {
            updateCreasesMeta();
            globals.creaseMaterialHasChanged = false;
        }
        if (globals.materialHasChanged) {
            updateMaterials();
            globals.materialHasChanged = false;
        }
        if (globals.shouldChangeCreasePercent) {
            setCreasePercent(globals.creasePercent);
            globals.shouldChangeCreasePercent = false;
        }
        // if (globals.shouldZeroDynamicVelocity){
        //     globals.gpuMath.step("zeroTexture", [], "u_velocity");
        //     globals.gpuMath.step("zeroTexture", [], "u_lastVelocity");
        //     globals.shouldZeroDynamicVelocity = false;
        // }
        if (globals.shouldCenterGeo){
            var avgPosition = getAvgPosition();
            globals.gpuMath.setProgram("centerTexture");
            globals.gpuMath.setUniformForProgram("centerTexture", "u_center", [avgPosition.x, avgPosition.y, avgPosition.z], "3f");
            globals.gpuMath.step("centerTexture", ["u_lastPosition"], "u_position");
            if (globals.integrationType == "verlet") globals.gpuMath.step("copyTexture", ["u_position"], "u_lastLastPosition");
            globals.gpuMath.swapTextures("u_position", "u_lastPosition");
            globals.gpuMath.step("zeroTexture", [], "u_lastVelocity");
            globals.gpuMath.step("zeroTexture", [], "u_velocity");
            globals.shouldCenterGeo = false;
        }

        if (_numSteps === undefined) _numSteps = globals.numSteps;
        for (var j=0;j<_numSteps;j++){
            solveStep();
        }
        render();
    }

    function solveStep(){

        var gpuMath = globals.gpuMath;

        gpuMath.setProgram("normalCalc");
        gpuMath.setSize(textureDimFaces, textureDimFaces);
        gpuMath.step("normalCalc", ["u_faceVertexIndices", "u_lastPosition", "u_originalPosition"], "u_normals");

        gpuMath.setProgram("thetaCalc");
        gpuMath.setSize(textureDimCreases, textureDimCreases);
        gpuMath.step("thetaCalc", ["u_normals", "u_lastTheta", "u_creaseVectors", "u_lastPosition",
            "u_originalPosition"], "u_theta");

        gpuMath.setProgram("updateCreaseGeo");
        //already at textureDimCreasesxtextureDimCreases
        gpuMath.step("updateCreaseGeo", ["u_lastPosition", "u_originalPosition", "u_creaseMeta2"], "u_creaseGeo");

        if (globals.integrationType == "verlet"){
            gpuMath.setProgram("positionCalcVerlet");
            gpuMath.setSize(textureDim, textureDim);
            gpuMath.step("positionCalcVerlet", ["u_lastPosition", "u_lastLastPosition", "u_lastVelocity", "u_originalPosition", "u_externalForces",
                "u_mass", "u_meta", "u_beamMeta", "u_creaseMeta", "u_nodeCreaseMeta", "u_normals", "u_theta", "u_creaseGeo",
                "u_meta2", "u_nodeFaceMeta", "u_nominalTriangles"], "u_position");
            gpuMath.step("velocityCalcVerlet", ["u_position", "u_lastPosition", "u_mass"], "u_velocity");
            gpuMath.swapTextures("u_lastPosition", "u_lastLastPosition");
        } else {//euler
            gpuMath.setProgram("velocityCalc");
            gpuMath.setSize(textureDim, textureDim);
            gpuMath.step("velocityCalc", ["u_lastPosition", "u_lastVelocity", "u_originalPosition", "u_externalForces",
                "u_mass", "u_meta", "u_beamMeta", "u_creaseMeta", "u_nodeCreaseMeta", "u_normals", "u_theta", "u_creaseGeo",
                "u_meta2", "u_nodeFaceMeta", "u_nominalTriangles"], "u_velocity");
            gpuMath.step("positionCalc", ["u_velocity", "u_lastPosition", "u_mass"], "u_position");
        }

        gpuMath.swapTextures("u_theta", "u_lastTheta");
        gpuMath.swapTextures("u_velocity", "u_lastVelocity");
        gpuMath.swapTextures("u_position", "u_lastPosition");
    }

    var $errorOutput = $("#globalError");

    function getAvgPosition(){
        var xavg = 0;
        var yavg = 0;
        var zavg = 0;
        for (var i=0;i<positions.length;i+=3){
            xavg += positions[i];
            yavg += positions[i+1];
            zavg += positions[i+2];
        }
        var avgPosition = new THREE.Vector3(xavg, yavg, zavg);
        avgPosition.multiplyScalar(3/positions.length);
        return avgPosition;
    }

    function render(){

        var vectorLength = 4;
        globals.gpuMath.setProgram("packToBytes");
        globals.gpuMath.setUniformForProgram("packToBytes", "u_vectorLength", vectorLength, "1f");
        globals.gpuMath.setUniformForProgram("packToBytes", "u_floatTextureDim", [textureDim, textureDim], "2f");
        globals.gpuMath.setSize(textureDim*vectorLength, textureDim);
        globals.gpuMath.step("packToBytes", ["u_lastPosition"], "outputBytes");

        if (globals.gpuMath.readyToRead()) {
            var numPixels = nodes.length*vectorLength;
            var height = Math.ceil(numPixels/(textureDim*vectorLength));
            var pixels = new Uint8Array(height*textureDim*4*vectorLength);
            globals.gpuMath.readPixels(0, 0, textureDim * vectorLength, height, pixels);
            var parsedPixels = new Float32Array(pixels.buffer);
            var globalError = 0;
            var shouldUpdateColors = globals.colorMode == "axialStrain";
            for (var i = 0; i < nodes.length; i++) {
                var rgbaIndex = i * vectorLength;
                var nodeError = parsedPixels[rgbaIndex+3]*100;
                globalError += nodeError;
                var nodePosition = new THREE.Vector3(parsedPixels[rgbaIndex], parsedPixels[rgbaIndex + 1], parsedPixels[rgbaIndex + 2]);
                nodePosition.add(nodes[i]._originalPosition);
                positions[3*i] = nodePosition.x;
                positions[3*i+1] = nodePosition.y;
                positions[3*i+2] = nodePosition.z;
                if (shouldUpdateColors){
                    if (nodeError>globals.strainClip) nodeError = globals.strainClip;
                    var scaledVal = (1-nodeError/globals.strainClip) * 0.7;
                    var color = new THREE.Color();
                    color.setHSL(scaledVal, 1, 0.5);
                    colors[3*i] = color.r;
                    colors[3*i+1] = color.g;
                    colors[3*i+2] = color.b;
                }
            }
            $errorOutput.html((globalError/nodes.length).toFixed(7) + " %");
        } else {
            console.log("shouldn't be here");
        }
    }

    function setSolveParams(){
        var dt = calcDt();
        $("#deltaT").html(dt);
        globals.gpuMath.setProgram("thetaCalc");
        globals.gpuMath.setUniformForProgram("thetaCalc", "u_dt", dt, "1f");
        globals.gpuMath.setProgram("velocityCalc");
        globals.gpuMath.setUniformForProgram("velocityCalc", "u_dt", dt, "1f");
        globals.gpuMath.setProgram("positionCalcVerlet");
        globals.gpuMath.setUniformForProgram("positionCalcVerlet", "u_dt", dt, "1f");
        globals.gpuMath.setProgram("positionCalc");
        globals.gpuMath.setUniformForProgram("positionCalc", "u_dt", dt, "1f");
        globals.gpuMath.setProgram("velocityCalcVerlet");
        globals.gpuMath.setUniformForProgram("velocityCalcVerlet", "u_dt", dt, "1f");
        globals.controls.setDeltaT(dt);
    }

    function calcDt(){
        var maxFreqNat = 0;
        _.each(edges, function(beam){
            if (beam.getNaturalFrequency()>maxFreqNat) maxFreqNat = beam.getNaturalFrequency();
        });
        return (1/(2*Math.PI*maxFreqNat))*0.9;//0.9 of max delta t for good measure
    }

    function initTexturesAndPrograms(gpuMath){

        var vertexShader = document.getElementById("vertexShader").text;

        gpuMath.initTextureFromData("u_position", textureDim, textureDim, "FLOAT", position, true);
        gpuMath.initTextureFromData("u_lastPosition", textureDim, textureDim, "FLOAT", lastPosition, true);
        gpuMath.initTextureFromData("u_lastLastPosition", textureDim, textureDim, "FLOAT", lastLastPosition, true);
        gpuMath.initTextureFromData("u_velocity", textureDim, textureDim, "FLOAT", velocity, true);
        gpuMath.initTextureFromData("u_lastVelocity", textureDim, textureDim, "FLOAT", lastVelocity, true);
        gpuMath.initTextureFromData("u_theta", textureDimCreases, textureDimCreases, "FLOAT", theta, true);
        gpuMath.initTextureFromData("u_lastTheta", textureDimCreases, textureDimCreases, "FLOAT", lastTheta, true);
        gpuMath.initTextureFromData("u_normals", textureDimFaces, textureDimFaces, "FLOAT", normals, true);

        gpuMath.initFrameBufferForTexture("u_position", true);
        gpuMath.initFrameBufferForTexture("u_lastPosition", true);
        gpuMath.initFrameBufferForTexture("u_lastLastPosition", true);
        gpuMath.initFrameBufferForTexture("u_velocity", true);
        gpuMath.initFrameBufferForTexture("u_lastVelocity", true);
        gpuMath.initFrameBufferForTexture("u_theta", true);
        gpuMath.initFrameBufferForTexture("u_lastTheta", true);
        gpuMath.initFrameBufferForTexture("u_normals", true);

        gpuMath.initTextureFromData("u_meta", textureDim, textureDim, "FLOAT", meta, true);
        gpuMath.initTextureFromData("u_meta2", textureDim, textureDim, "FLOAT", meta2, true);
        gpuMath.initTextureFromData("u_nominalTrinagles", textureDimFaces, textureDimFaces, "FLOAT", nominalTriangles, true);
        gpuMath.initTextureFromData("u_nodeCreaseMeta", textureDimNodeCreases, textureDimNodeCreases, "FLOAT", nodeCreaseMeta, true);
        gpuMath.initTextureFromData("u_creaseMeta2", textureDimCreases, textureDimCreases, "FLOAT", creaseMeta2, true);
        gpuMath.initTextureFromData("u_nodeFaceMeta", textureDimNodeFaces, textureDimNodeFaces, "FLOAT", nodeFaceMeta, true);
        gpuMath.initTextureFromData("u_creaseGeo", textureDimCreases, textureDimCreases, "FLOAT", creaseGeo, true);
        gpuMath.initFrameBufferForTexture("u_creaseGeo", true);
        gpuMath.initTextureFromData("u_faceVertexIndices", textureDimFaces, textureDimFaces, "FLOAT", faceVertexIndices, true);
        gpuMath.initTextureFromData("u_nominalTriangles", textureDimFaces, textureDimFaces, "FLOAT", nominalTriangles, true);

        gpuMath.createProgram("positionCalc", vertexShader, document.getElementById("positionCalcShader").text);
        gpuMath.setUniformForProgram("positionCalc", "u_velocity", 0, "1i");
        gpuMath.setUniformForProgram("positionCalc", "u_lastPosition", 1, "1i");
        gpuMath.setUniformForProgram("positionCalc", "u_mass", 2, "1i");
        gpuMath.setUniformForProgram("positionCalc", "u_textureDim", [textureDim, textureDim], "2f");

        gpuMath.createProgram("velocityCalcVerlet", vertexShader, document.getElementById("velocityCalcVerletShader").text);
        gpuMath.setUniformForProgram("velocityCalcVerlet", "u_position", 0, "1i");
        gpuMath.setUniformForProgram("velocityCalcVerlet", "u_lastPosition", 1, "1i");
        gpuMath.setUniformForProgram("velocityCalcVerlet", "u_mass", 2, "1i");
        gpuMath.setUniformForProgram("velocityCalcVerlet", "u_textureDim", [textureDim, textureDim], "2f");

        gpuMath.createProgram("velocityCalc", vertexShader, document.getElementById("velocityCalcShader").text);
        gpuMath.setUniformForProgram("velocityCalc", "u_lastPosition", 0, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_lastVelocity", 1, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_originalPosition", 2, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_externalForces", 3, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_mass", 4, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_meta", 5, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_beamMeta", 6, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_creaseMeta", 7, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_nodeCreaseMeta", 8, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_normals", 9, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_theta", 10, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_creaseGeo", 11, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_meta2", 12, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_nodeFaceMeta", 13, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_nominalTriangles", 14, "1i");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDimEdges", [textureDimEdges, textureDimEdges], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDimFaces", [textureDimFaces, textureDimFaces], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDimCreases", [textureDimCreases, textureDimCreases], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDimNodeCreases", [textureDimNodeCreases, textureDimNodeCreases], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_textureDimNodeFaces", [textureDimNodeFaces, textureDimNodeFaces], "2f");
        gpuMath.setUniformForProgram("velocityCalc", "u_creasePercent", globals.creasePercent, "1f");
        gpuMath.setUniformForProgram("velocityCalc", "u_axialStiffness", globals.axialStiffness, "1f");
        gpuMath.setUniformForProgram("velocityCalc", "u_faceStiffness", globals.faceStiffness, "1f");
        gpuMath.setUniformForProgram("velocityCalc", "u_calcFaceStrain", globals.calcFaceStrain, "1f");

        gpuMath.createProgram("positionCalcVerlet", vertexShader, document.getElementById("positionCalcVerletShader").text);
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_lastPosition", 0, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_lastLastPosition", 1, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_lastVelocity", 2, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_originalPosition", 3, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_externalForces", 4, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_mass", 5, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_meta", 6, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_beamMeta", 7, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_creaseMeta", 8, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_nodeCreaseMeta", 9, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_normals", 10, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_theta", 11, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_creaseGeo", 12, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_meta2", 13, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_nodeFaceMeta", 14, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_nominalTriangles", 15, "1i");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDimEdges", [textureDimEdges, textureDimEdges], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDimFaces", [textureDimFaces, textureDimFaces], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDimCreases", [textureDimCreases, textureDimCreases], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDimNodeCreases", [textureDimNodeCreases, textureDimNodeCreases], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_textureDimNodeFaces", [textureDimNodeFaces, textureDimNodeFaces], "2f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_creasePercent", globals.creasePercent, "1f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_axialStiffness", globals.axialStiffness, "1f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_faceStiffness", globals.faceStiffness, "1f");
        gpuMath.setUniformForProgram("positionCalcVerlet", "u_calcFaceStrain", globals.calcFaceStrain, "1f");

        gpuMath.createProgram("thetaCalc", vertexShader, document.getElementById("thetaCalcShader").text);
        gpuMath.setUniformForProgram("thetaCalc", "u_normals", 0, "1i");
        gpuMath.setUniformForProgram("thetaCalc", "u_lastTheta", 1, "1i");
        gpuMath.setUniformForProgram("thetaCalc", "u_creaseVectors", 2, "1i");
        gpuMath.setUniformForProgram("thetaCalc", "u_lastPosition", 3, "1i");
        gpuMath.setUniformForProgram("thetaCalc", "u_originalPosition", 4, "1i");
        gpuMath.setUniformForProgram("thetaCalc", "u_textureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("thetaCalc", "u_textureDimFaces", [textureDimFaces, textureDimFaces], "2f");
        gpuMath.setUniformForProgram("thetaCalc", "u_textureDimCreases", [textureDimCreases, textureDimCreases], "2f");

        gpuMath.createProgram("normalCalc", vertexShader, document.getElementById("normalCalc").text);
        gpuMath.setUniformForProgram("normalCalc", "u_faceVertexIndices", 0, "1i");
        gpuMath.setUniformForProgram("normalCalc", "u_lastPosition", 1, "1i");
        gpuMath.setUniformForProgram("normalCalc", "u_originalPosition", 2, "1i");
        gpuMath.setUniformForProgram("normalCalc", "u_textureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("normalCalc", "u_textureDimFaces", [textureDimFaces, textureDimFaces], "2f");

        gpuMath.createProgram("packToBytes", vertexShader, document.getElementById("packToBytesShader").text);
        gpuMath.initTextureFromData("outputBytes", textureDim*4, textureDim, "UNSIGNED_BYTE", null, true);
        gpuMath.initFrameBufferForTexture("outputBytes", true);
        gpuMath.setUniformForProgram("packToBytes", "u_floatTextureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("packToBytes", "u_floatTexture", 0, "1i");

        gpuMath.createProgram("zeroTexture", vertexShader, document.getElementById("zeroTexture").text);
        gpuMath.createProgram("zeroThetaTexture", vertexShader, document.getElementById("zeroThetaTexture").text);
        gpuMath.setUniformForProgram("zeroThetaTexture", "u_theta", 0, "1i");
        gpuMath.setUniformForProgram("zeroThetaTexture", "u_textureDimCreases", [textureDimCreases, textureDimCreases], "2f");

        gpuMath.createProgram("centerTexture", vertexShader, document.getElementById("centerTexture").text);
        gpuMath.setUniformForProgram("centerTexture", "u_lastPosition", 0, "1i");
        gpuMath.setUniformForProgram("centerTexture", "u_textureDim", [textureDim, textureDim], "2f");

        gpuMath.createProgram("copyTexture", vertexShader, document.getElementById("copyTexture").text);
        gpuMath.setUniformForProgram("copyTexture", "u_orig", 0, "1i");
        gpuMath.setUniformForProgram("copyTexture", "u_textureDim", [textureDim, textureDim], "2f");

        gpuMath.createProgram("updateCreaseGeo", vertexShader, document.getElementById("updateCreaseGeo").text);
        gpuMath.setUniformForProgram("updateCreaseGeo", "u_lastPosition", 0, "1i");
        gpuMath.setUniformForProgram("updateCreaseGeo", "u_originalPosition", 1, "1i");
        gpuMath.setUniformForProgram("updateCreaseGeo", "u_creaseMeta2", 2, "1i");
        gpuMath.setUniformForProgram("updateCreaseGeo", "u_textureDim", [textureDim, textureDim], "2f");
        gpuMath.setUniformForProgram("updateCreaseGeo", "u_textureDimCreases", [textureDimCreases, textureDimCreases], "2f");

        gpuMath.setSize(textureDim, textureDim);

        programsInited = true;
    }

    function calcTextureSize(numNodes){
        if (numNodes == 1) return 2;
        for (var i=0;i<numNodes;i++){
            if (Math.pow(2, 2*i) >= numNodes){
                return Math.pow(2, i);
            }
        }
        console.warn("no texture size found for " + numNodes + " items");
        return 2;
    }

    function updateMaterials(initing){
        var index = 0;
        for (var i=0;i<nodes.length;i++){
            if (initing) {
                meta[4*i] = index;
                meta[4*i+1] = nodes[i].numBeams();
            }
            for (var j=0;j<nodes[i].beams.length;j++){
                var beam = nodes[i].beams[j];
                beamMeta[4*index] = beam.getK();
                beamMeta[4*index+1] = beam.getD();
                if (initing) {
                    beamMeta[4*index+2] = beam.getLength();
                    beamMeta[4*index+3] = beam.getOtherNode(nodes[i]).getIndex();
                }
                index+=1;
            }
        }
        globals.gpuMath.initTextureFromData("u_beamMeta", textureDimEdges, textureDimEdges, "FLOAT", beamMeta, true);


        if (programsInited) {
            globals.gpuMath.setProgram("velocityCalc");
            globals.gpuMath.setUniformForProgram("velocityCalc", "u_axialStiffness", globals.axialStiffness, "1f");
            globals.gpuMath.setUniformForProgram("velocityCalc", "u_faceStiffness", globals.faceStiffness, "1f");
            globals.gpuMath.setProgram("positionCalcVerlet");
            globals.gpuMath.setUniformForProgram("positionCalcVerlet", "u_axialStiffness", globals.axialStiffness, "1f");
            globals.gpuMath.setUniformForProgram("positionCalcVerlet", "u_faceStiffness", globals.faceStiffness, "1f");
            setSolveParams();//recalc dt
        }
    }

    function updateExternalForces(){
        for (var i=0;i<nodes.length;i++){
            var externalForce = nodes[i].getExternalForce();
            externalForces[4*i] = externalForce.x;
            externalForces[4*i+1] = externalForce.y;
            externalForces[4*i+2] = externalForce.z;
        }
        globals.gpuMath.initTextureFromData("u_externalForces", textureDim, textureDim, "FLOAT", externalForces, true);
    }

    function updateFixed(){
        for (var i=0;i<nodes.length;i++){
            mass[4*i+1] = (nodes[i].isFixed() ? 1 : 0);
        }
        globals.gpuMath.initTextureFromData("u_mass", textureDim, textureDim, "FLOAT", mass, true);
    }

    function updateOriginalPosition(){
        for (var i=0;i<nodes.length;i++){
            var origPosition = nodes[i].getOriginalPosition();
            originalPosition[4*i] = origPosition.x;
            originalPosition[4*i+1] = origPosition.y;
            originalPosition[4*i+2] = origPosition.z;
        }
        globals.gpuMath.initTextureFromData("u_originalPosition", textureDim, textureDim, "FLOAT", originalPosition, true);
    }

    function updateCreaseVectors(){
        for (var i=0;i<creases.length;i++){
            var rgbaIndex = i*4;
            var nodes = creases[i].edge.nodes;
            // this.vertices[1].clone().sub(this.vertices[0]);
            creaseVectors[rgbaIndex] = nodes[0].getIndex();
            creaseVectors[rgbaIndex+1] = nodes[1].getIndex();
        }
        globals.gpuMath.initTextureFromData("u_creaseVectors", textureDimCreases, textureDimCreases, "FLOAT", creaseVectors, true);
    }

    function updateCreasesMeta(initing){
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            creaseMeta[i*4] = crease.getK();
            // creaseMeta[i*4+1] = crease.getD();
            creaseMeta[i*4+2] = crease.getTargetTheta();
        }
        globals.gpuMath.initTextureFromData("u_creaseMeta", textureDimCreases, textureDimCreases, "FLOAT", creaseMeta, true);
    }

    function updateLastPosition(){
        for (var i=0;i<nodes.length;i++){
            var _position = nodes[i].getRelativePosition();
            lastPosition[4*i] = _position.x;
            lastPosition[4*i+1] = _position.y;
            lastPosition[4*i+2] = _position.z;
        }
        globals.gpuMath.initTextureFromData("u_lastPosition", textureDim, textureDim, "FLOAT", lastPosition, true);
        globals.gpuMath.initFrameBufferForTexture("u_lastPosition", true);

    }

    function setCreasePercent(percent){
        if (!programsInited) return;
        globals.gpuMath.setProgram("velocityCalc");
        globals.gpuMath.setUniformForProgram("velocityCalc", "u_creasePercent", percent, "1f");
        globals.gpuMath.setProgram("positionCalcVerlet");
        globals.gpuMath.setUniformForProgram("positionCalcVerlet", "u_creasePercent", percent, "1f");
    }

    function initTypedArrays(){

        textureDim = calcTextureSize(nodes.length);

        var numNodeFaces = 0;
        var nodeFaces = [];
        for (var i=0;i<nodes.length;i++){
            nodeFaces.push([]);
            for (var j=0;j<faces.length;j++){
                if (faces[j].indexOf(i)>=0) {
                    nodeFaces[i].push(j);
                    numNodeFaces++;
                }
            }
        }
        textureDimNodeFaces = calcTextureSize(numNodeFaces);

        var numEdges = 0;
        for (var i=0;i<nodes.length;i++){
            numEdges += nodes[i].numBeams();
        }
        textureDimEdges = calcTextureSize(numEdges);

        var numCreases = creases.length;
        textureDimCreases = calcTextureSize(numCreases);

        var numNodeCreases = 0;
        for (var i=0;i<nodes.length;i++){
            numNodeCreases += nodes[i].numCreases();
        }
        numNodeCreases += numCreases*2;//reactions
        textureDimNodeCreases = calcTextureSize(numNodeCreases);

        var numFaces = faces.length;
        textureDimFaces = calcTextureSize(numFaces);

        originalPosition = new Float32Array(textureDim*textureDim*4);
        position = new Float32Array(textureDim*textureDim*4);
        lastPosition = new Float32Array(textureDim*textureDim*4);
        lastLastPosition = new Float32Array(textureDim*textureDim*4);
        velocity = new Float32Array(textureDim*textureDim*4);
        lastVelocity = new Float32Array(textureDim*textureDim*4);
        externalForces = new Float32Array(textureDim*textureDim*4);
        mass = new Float32Array(textureDim*textureDim*4);
        meta = new Float32Array(textureDim*textureDim*4);
        meta2 = new Float32Array(textureDim*textureDim*4);
        beamMeta = new Float32Array(textureDimEdges*textureDimEdges*4);

        normals = new Float32Array(textureDimFaces*textureDimFaces*4);
        faceVertexIndices = new Float32Array(textureDimFaces*textureDimFaces*4);
        creaseMeta = new Float32Array(textureDimCreases*textureDimCreases*4);
        nodeFaceMeta = new Float32Array(textureDimNodeFaces*textureDimNodeFaces*4);
        nominalTriangles = new Float32Array(textureDimFaces*textureDimFaces*4);
        nodeCreaseMeta = new Float32Array(textureDimNodeCreases*textureDimNodeCreases*4);
        creaseMeta2 = new Float32Array(textureDimCreases*textureDimCreases*4);
        creaseGeo = new Float32Array(textureDimCreases*textureDimCreases*4);
        creaseVectors = new Float32Array(textureDimCreases*textureDimCreases*4);
        theta = new Float32Array(textureDimCreases*textureDimCreases*4);
        lastTheta = new Float32Array(textureDimCreases*textureDimCreases*4);

        for (var i=0;i<faces.length;i++){
            var face = faces[i];
            faceVertexIndices[4*i] = face[0];
            faceVertexIndices[4*i+1] = face[1];
            faceVertexIndices[4*i+2] = face[2];

            var a = nodes[face[0]].getOriginalPosition();
            var b = nodes[face[1]].getOriginalPosition();
            var c = nodes[face[2]].getOriginalPosition();
            var ab = (b.clone().sub(a)).normalize();
            var ac = (c.clone().sub(a)).normalize();
            var bc = (c.clone().sub(b)).normalize();
            nominalTriangles[4*i] = Math.acos(ab.dot(ac));
            nominalTriangles[4*i+1] = Math.acos(-1*ab.dot(bc));
            nominalTriangles[4*i+2] = Math.acos(ac.dot(bc));

            if (Math.abs(nominalTriangles[4*i]+nominalTriangles[4*i+1]+nominalTriangles[4*i+2]-Math.PI)>0.1){
                console.warn("bad angles");
            }
        }


        for (var i=0;i<textureDim*textureDim;i++){
            mass[4*i+1] = (nodes[i] && nodes[i].isFixed()) ? 1 : 0;
        }

        for (var i=0;i<textureDimCreases*textureDimCreases;i++){
            if (i >= numCreases){
                lastTheta[i*4+2] = -1;
                lastTheta[i*4+3] = -1;
                continue;
            }
            lastTheta[i*4+2] = creases[i].getNormal1Index();
            lastTheta[i*4+3] = creases[i].getNormal2Index();
        }

        var index = 0;
        for (var i=0;i<nodes.length;i++){
            meta2[4*i] = index;
            var num = nodeFaces[i].length;
            meta2[4*i+1] = num;
            for (var j=0;j<num;j++){
                var _index = (index+j)*4;
                var face = faces[nodeFaces[i][j]];
                nodeFaceMeta[_index] = nodeFaces[i][j];
                nodeFaceMeta[_index+1] = face[0] == i ? -1 : face[0];
                nodeFaceMeta[_index+2] = face[1] == i ? -1 : face[1];
                nodeFaceMeta[_index+3] = face[2] == i ? -1 : face[2];
            }
            index+=num;
        }

        var index = 0;
        for (var i=0;i<nodes.length;i++){
            mass[4*i] = nodes[i].getSimMass();
            meta[i*4+2] = index;
            var nodeCreases = nodes[i].creases;
            var nodeInvCreases = nodes[i].invCreases;//nodes attached to crease move in opposite direction
            // console.log(nodeInvCreases);
            meta[i*4+3] = nodeCreases.length + nodeInvCreases.length;
            for (var j=0;j<nodeCreases.length;j++){
                nodeCreaseMeta[index*4] = nodeCreases[j].getIndex();
                nodeCreaseMeta[index*4+1] = nodeCreases[j].getNodeIndex(nodes[i]);//type 1, 2, 3, 4
                index++;
            }
            for (var j=0;j<nodeInvCreases.length;j++){
                nodeCreaseMeta[index*4] = nodeInvCreases[j].getIndex();
                nodeCreaseMeta[index*4+1] = nodeInvCreases[j].getNodeIndex(nodes[i]);//type 1, 2, 3, 4
                index++;
            }
        }
        for (var i=0;i<creases.length;i++){
            var crease = creases[i];
            creaseMeta2[i*4] = crease.node1.getIndex();
            creaseMeta2[i*4+1] = crease.node2.getIndex();
            creaseMeta2[i*4+2] = crease.edge.nodes[0].getIndex();
            creaseMeta2[i*4+3] = crease.edge.nodes[1].getIndex();
            index++;
        }

        updateOriginalPosition();
        updateMaterials(true);
        updateFixed();
        updateExternalForces();
        updateCreasesMeta(true);
        updateCreaseVectors();
        setCreasePercent(globals.creasePercent);
    }

    return {
        syncNodesAndEdges: syncNodesAndEdges,
        updateFixed: updateFixed,
        solve: solve,
        render: render,
        reset: reset
    }
}

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
