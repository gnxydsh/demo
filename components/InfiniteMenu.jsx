'use client';

import { useEffect, useRef, useState } from 'react';
import { mat4, quat, vec2, vec3 } from 'gl-matrix';
import './InfiniteMenu.css';

const discVertShaderSource = `#version 300 es

uniform mat4 uWorldMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform vec3 uCameraPosition;
uniform vec4 uRotationAxisVelocity;

in vec3 aModelPosition;
in vec3 aModelNormal;
in vec2 aModelUvs;
in mat4 aInstanceMatrix;

out vec2 vUvs;
out float vAlpha;
flat out int vInstanceId;

#define PI 3.141593

void main() {
    vec4 worldPosition = uWorldMatrix * aInstanceMatrix * vec4(aModelPosition, 1.);

    vec3 centerPos = (uWorldMatrix * aInstanceMatrix * vec4(0., 0., 0., 1.)).xyz;
    float radius = length(centerPos.xyz);

    if (gl_VertexID > 0) {
        vec3 rotationAxis = uRotationAxisVelocity.xyz;
        float rotationVelocity = min(.15, uRotationAxisVelocity.w * 15.);
        vec3 stretchDir = normalize(cross(centerPos, rotationAxis));
        vec3 relativeVertexPos = normalize(worldPosition.xyz - centerPos);
        float strength = dot(stretchDir, relativeVertexPos);
        float invAbsStrength = min(0., abs(strength) - 1.);
        strength = rotationVelocity * sign(strength) * abs(invAbsStrength * invAbsStrength * invAbsStrength + 1.);
        worldPosition.xyz += stretchDir * strength;
    }

    worldPosition.xyz = radius * normalize(worldPosition.xyz);

    gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;

    vAlpha = smoothstep(0.5, 1., normalize(worldPosition.xyz).z) * .9 + .1;
    vUvs = aModelUvs;
    vInstanceId = gl_InstanceID;
}
`;

const discFragShaderSource = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform int uItemCount;
uniform int uAtlasSize;
uniform int uActiveDisc;
uniform float uSpinAngle;

out vec4 outColor;

in vec2 vUvs;
in float vAlpha;
flat in int vInstanceId;

#define PI 3.141593

void main() {
    int itemIndex = vInstanceId % uItemCount;
    int cellsPerRow = uAtlasSize;
    int cellX = itemIndex % cellsPerRow;
    int cellY = itemIndex / cellsPerRow;
    vec2 cellSize = vec2(1.0) / vec2(float(cellsPerRow));
    vec2 cellOffset = vec2(float(cellX), float(cellY)) * cellSize;

    ivec2 texSize = textureSize(uTex, 0);
    float imageAspect = float(texSize.x) / float(texSize.y);
    float scale = max(imageAspect, 1.0 / imageAspect);

    // 以圆心为原点，r = 1 对应唱片边缘
    vec2 pRaw = vUvs - 0.5;
    vec2 p = pRaw;
    // 正对镜头的唱片在播放时缓慢自转
    if (vInstanceId == uActiveDisc) {
        float c = cos(uSpinAngle);
        float s = sin(uSpinAngle);
        p = mat2(c, -s, s, c) * p;
    }
    float r = length(pRaw) * 2.0;
    // 高光、印记等角度特征取自旋转后的坐标，随唱片一起转动
    float angle = atan(p.y, p.x);

    const float labelRadius = 0.42; // 中心标签（专辑封面）半径
    const float holeRadius = 0.05;  // 中心轴孔半径

    // 远处小唱片的细纹低于像素精度，逐步淡出防止闪烁
    float ringFreq = 420.0;
    float fw = fwidth(r) * ringFreq / (2.0 * PI);
    float detailAA = 1.0 - smoothstep(0.25, 0.85, fw);
    float aa = max(0.006, fwidth(r) * 1.5);

    // ---------- 黑胶部分 ----------
    vec3 vinyl = vec3(0.040, 0.040, 0.046);

    // 同心音轨纹路（叠加轻微角向扰动，转动时盘面有流动的纹理感）
    float grooves = 0.5 + 0.5 * sin(r * ringFreq + sin(angle * 3.0) * 1.2);
    float grooveMask = smoothstep(labelRadius + 0.02, labelRadius + 0.10, r) * (1.0 - smoothstep(0.93, 0.99, r));
    vinyl += vec3(grooves * 0.05 * grooveMask * detailAA);

    // 分轨暗环
    float bands = 0.0;
    bands += 1.0 - smoothstep(0.004, 0.016, abs(r - 0.58));
    bands += 1.0 - smoothstep(0.004, 0.016, abs(r - 0.72));
    bands += 1.0 - smoothstep(0.004, 0.016, abs(r - 0.86));
    vinyl *= 1.0 - 0.35 * bands * detailAA;

    // 两道相对的扇形反光（烘焙在盘面上，随唱片一起转动）
    float sheen = pow(max(cos(angle - 0.8), 0.0), 28.0) + pow(max(cos(angle - 0.8 + PI), 0.0), 28.0);
    float sheenMask = smoothstep(labelRadius + 0.05, labelRadius + 0.20, r) * (1.0 - smoothstep(0.88, 0.98, r));
    vinyl += vec3(0.55, 0.58, 0.65) * sheen * sheenMask * 0.16;

    // 盘面上的一点微小印记，随自转绕圈，让黑胶的转动更直观
    vec2 markPos = vec2(cos(2.2), sin(2.2)) * 0.44;
    float mark = 1.0 - smoothstep(0.004, 0.010, length(p - markPos));
    vinyl += vec3(0.18, 0.18, 0.19) * mark * detailAA;

    // 外圈压暗 + 边缘一圈细亮线
    vinyl *= 1.0 - 0.35 * smoothstep(0.95, 1.0, r);
    vinyl += vec3(0.10) * (1.0 - smoothstep(0.0, 0.008, abs(r - 0.994))) * detailAA;

    // ---------- 标签部分（专辑封面圆形裁剪进标签区） ----------
    vec2 st = vec2(p.x + 0.5, 0.5 - p.y);
    vec2 labelUv = (st - 0.5) / labelRadius + 0.5;
    labelUv = (labelUv - 0.5) * scale + 0.5;
    labelUv = clamp(labelUv, 0.0, 1.0);
    labelUv = labelUv * cellSize + cellOffset;
    vec3 label = texture(uTex, labelUv).rgb * 0.95;

    // ---------- 合成 ----------
    vec3 color = mix(vinyl, label, 1.0 - smoothstep(labelRadius - aa, labelRadius + aa, r));

    // 标签外圈描边
    float labelRim = (1.0 - smoothstep(0.0, 0.006, abs(r - labelRadius - 0.005))) * step(labelRadius, r);
    color += vec3(0.12) * labelRim;

    // 中心轴孔与孔边亮环
    color = mix(color, vec3(0.015), 1.0 - smoothstep(holeRadius - aa, holeRadius + aa, r));
    float holeRim = (1.0 - smoothstep(0.0, 0.005, abs(r - holeRadius - 0.004))) * step(holeRadius, r);
    color += vec3(0.20) * holeRim;

    outColor = vec4(color, 1.0);
    outColor.a *= vAlpha;
}
`;

class Face {
  constructor(a, b, c) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
}

class Vertex {
  constructor(x, y, z) {
    this.position = vec3.fromValues(x, y, z);
    this.normal = vec3.create();
    this.uv = vec2.create();
  }
}

class Geometry {
  constructor() {
    this.vertices = [];
    this.faces = [];
  }

  addVertex(...args) {
    for (let i = 0; i < args.length; i += 3) {
      this.vertices.push(new Vertex(args[i], args[i + 1], args[i + 2]));
    }
    return this;
  }

  addFace(...args) {
    for (let i = 0; i < args.length; i += 3) {
      this.faces.push(new Face(args[i], args[i + 1], args[i + 2]));
    }
    return this;
  }

  get lastVertex() {
    return this.vertices[this.vertices.length - 1];
  }

  subdivide(divisions = 1) {
    const midPointCache = {};
    let f = this.faces;

    for (let div = 0; div < divisions; ++div) {
      const newFaces = new Array(f.length * 4);

      f.forEach((face, ndx) => {
        const mAB = this.getMidPoint(face.a, face.b, midPointCache);
        const mBC = this.getMidPoint(face.b, face.c, midPointCache);
        const mCA = this.getMidPoint(face.c, face.a, midPointCache);

        const i = ndx * 4;
        newFaces[i + 0] = new Face(face.a, mAB, mCA);
        newFaces[i + 1] = new Face(face.b, mBC, mAB);
        newFaces[i + 2] = new Face(face.c, mCA, mBC);
        newFaces[i + 3] = new Face(mAB, mBC, mCA);
      });

      f = newFaces;
    }

    this.faces = f;
    return this;
  }

  spherize(radius = 1) {
    this.vertices.forEach(vertex => {
      vec3.normalize(vertex.normal, vertex.position);
      vec3.scale(vertex.position, vertex.normal, radius);
    });
    return this;
  }

  get data() {
    return {
      vertices: this.vertexData,
      indices: this.indexData,
      normals: this.normalData,
      uvs: this.uvData
    };
  }

  get vertexData() {
    return new Float32Array(this.vertices.flatMap(v => Array.from(v.position)));
  }

  get normalData() {
    return new Float32Array(this.vertices.flatMap(v => Array.from(v.normal)));
  }

  get uvData() {
    return new Float32Array(this.vertices.flatMap(v => Array.from(v.uv)));
  }

  get indexData() {
    return new Uint16Array(this.faces.flatMap(f => [f.a, f.b, f.c]));
  }

  getMidPoint(ndxA, ndxB, cache) {
    const cacheKey = ndxA < ndxB ? `k_${ndxB}_${ndxA}` : `k_${ndxA}_${ndxB}`;
    if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
      return cache[cacheKey];
    }
    const a = this.vertices[ndxA].position;
    const b = this.vertices[ndxB].position;
    const ndx = this.vertices.length;
    cache[cacheKey] = ndx;
    this.addVertex((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    return ndx;
  }
}

class IcosahedronGeometry extends Geometry {
  constructor() {
    super();
    const t = Math.sqrt(5) * 0.5 + 0.5;
    this.addVertex(
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      0,
      0,
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      t,
      0,
      -1,
      t,
      0,
      1,
      -t,
      0,
      -1,
      -t,
      0,
      1
    ).addFace(
      0,
      11,
      5,
      0,
      5,
      1,
      0,
      1,
      7,
      0,
      7,
      10,
      0,
      10,
      11,
      1,
      5,
      9,
      5,
      11,
      4,
      11,
      10,
      2,
      10,
      7,
      6,
      7,
      1,
      8,
      3,
      9,
      4,
      3,
      4,
      2,
      3,
      2,
      6,
      3,
      6,
      8,
      3,
      8,
      9,
      4,
      9,
      5,
      2,
      4,
      11,
      6,
      2,
      10,
      8,
      6,
      7,
      9,
      8,
      1
    );
  }
}

class DiscGeometry extends Geometry {
  constructor(steps = 4, radius = 1) {
    super();
    steps = Math.max(4, steps);

    const alpha = (2 * Math.PI) / steps;

    this.addVertex(0, 0, 0);
    this.lastVertex.uv[0] = 0.5;
    this.lastVertex.uv[1] = 0.5;

    for (let i = 0; i < steps; ++i) {
      const x = Math.cos(alpha * i);
      const y = Math.sin(alpha * i);
      this.addVertex(radius * x, radius * y, 0);
      this.lastVertex.uv[0] = x * 0.5 + 0.5;
      this.lastVertex.uv[1] = y * 0.5 + 0.5;

      if (i > 0) {
        this.addFace(0, i, i + 1);
      }
    }
    this.addFace(0, steps, 1);
  }
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);

  if (success) {
    return shader;
  }

  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl, shaderSources, transformFeedbackVaryings, attribLocations) {
  const program = gl.createProgram();

  [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, ndx) => {
    const shader = createShader(gl, type, shaderSources[ndx]);
    if (shader) gl.attachShader(program, shader);
  });

  if (transformFeedbackVaryings) {
    gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.SEPARATE_ATTRIBS);
  }

  if (attribLocations) {
    for (const attrib in attribLocations) {
      gl.bindAttribLocation(program, attribLocations[attrib], attrib);
    }
  }

  gl.linkProgram(program);
  const success = gl.getProgramParameter(program, gl.LINK_STATUS);

  if (success) {
    return program;
  }

  console.error(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

function makeVertexArray(gl, bufLocNumElmPairs, indices) {
  const va = gl.createVertexArray();
  gl.bindVertexArray(va);

  for (const [buffer, loc, numElem] of bufLocNumElmPairs) {
    if (loc === -1) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, numElem, gl.FLOAT, false, 0, 0);
  }

  if (indices) {
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  }

  gl.bindVertexArray(null);
  return va;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio);
  const displayWidth = Math.round(canvas.clientWidth * dpr);
  const displayHeight = Math.round(canvas.clientHeight * dpr);
  const needResize = canvas.width !== displayWidth || canvas.height !== displayHeight;
  if (needResize) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  return needResize;
}

function makeBuffer(gl, sizeOrData, usage) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, sizeOrData, usage);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buf;
}

function createAndSetupTexture(gl, minFilter, magFilter, wrapS, wrapT) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  return texture;
}

class ArcballControl {
  isPointerDown = false;
  orientation = quat.create();
  pointerRotation = quat.create();
  rotationVelocity = 0;
  rotationAxis = vec3.fromValues(1, 0, 0);
  snapDirection = vec3.fromValues(0, 0, -1);
  snapTargetDirection;
  EPSILON = 0.1;
  IDENTITY_QUAT = quat.create();

  constructor(canvas, updateCallback) {
    this.canvas = canvas;
    this.updateCallback = updateCallback || (() => null);

    this.pointerPos = vec2.create();
    this.previousPointerPos = vec2.create();
    this._rotationVelocity = 0;
    this._combinedQuat = quat.create();

    canvas.addEventListener('pointerdown', e => {
      // 只有中央圆形专辑图区域可以拖动，其他区域不响应
      if (!this.#isInsideDragArea(e)) return;
      vec2.set(this.pointerPos, e.clientX, e.clientY);
      vec2.copy(this.previousPointerPos, this.pointerPos);
      this.isPointerDown = true;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointerup', () => {
      this.isPointerDown = false;
      canvas.style.cursor = 'default';
    });
    canvas.addEventListener('pointerleave', () => {
      this.isPointerDown = false;
      canvas.style.cursor = 'default';
    });
    canvas.addEventListener('pointermove', e => {
      if (this.isPointerDown) {
        vec2.set(this.pointerPos, e.clientX, e.clientY);
      } else {
        canvas.style.cursor = this.#isInsideDragArea(e) ? 'grab' : 'default';
      }
    });

    canvas.style.touchAction = 'none';
  }

  /** 手势等外部指针：按下（clientX/clientY 坐标系） */
  externalDown(x, y) {
    vec2.set(this.pointerPos, x, y);
    vec2.copy(this.previousPointerPos, this.pointerPos);
    this.isPointerDown = true;
  }

  /** 手势等外部指针：移动 */
  externalMove(x, y) {
    if (this.isPointerDown) {
      vec2.set(this.pointerPos, x, y);
    }
  }

  /** 手势等外部指针：抬起释放 */
  externalUp() {
    this.isPointerDown = false;
  }

  /** 判断指针是否位于画布中央的圆形可拖动区域内 */
  #isInsideDragArea(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = (Math.min(rect.width, rect.height) / 2) * 0.7;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  update(deltaTime, targetFrameDuration = 16) {
    const timeScale = deltaTime / targetFrameDuration + 0.00001;
    let angleFactor = timeScale;
    let snapRotation = quat.create();

    if (this.isPointerDown) {
      const INTENSITY = 0.3 * timeScale;
      const ANGLE_AMPLIFICATION = 5 / timeScale;

      const midPointerPos = vec2.sub(vec2.create(), this.pointerPos, this.previousPointerPos);
      vec2.scale(midPointerPos, midPointerPos, INTENSITY);

      if (vec2.sqrLen(midPointerPos) > this.EPSILON) {
        vec2.add(midPointerPos, this.previousPointerPos, midPointerPos);

        const p = this.#project(midPointerPos);
        const q = this.#project(this.previousPointerPos);
        const a = vec3.normalize(vec3.create(), p);
        const b = vec3.normalize(vec3.create(), q);

        vec2.copy(this.previousPointerPos, midPointerPos);

        angleFactor *= ANGLE_AMPLIFICATION;

        this.quatFromVectors(a, b, this.pointerRotation, angleFactor);
      } else {
        quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, INTENSITY);
      }
    } else {
      const INTENSITY = 0.1 * timeScale;
      quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, INTENSITY);

      if (this.snapTargetDirection) {
        // 吸附强度：值越大唱片旋转到位越快
        const SNAPPING_INTENSITY = 0.5;
        const a = this.snapTargetDirection;
        const b = this.snapDirection;
        const sqrDist = vec3.squaredDistance(a, b);
        // 提高下限，避免距离远时起步过慢
        const distanceFactor = Math.max(0.35, 1 - sqrDist * 10);
        angleFactor *= SNAPPING_INTENSITY * distanceFactor;
        this.quatFromVectors(a, b, snapRotation, angleFactor);
      }
    }

    const combinedQuat = quat.multiply(quat.create(), snapRotation, this.pointerRotation);
    this.orientation = quat.multiply(quat.create(), combinedQuat, this.orientation);
    quat.normalize(this.orientation, this.orientation);

    const RA_INTENSITY = 0.8 * timeScale;
    quat.slerp(this._combinedQuat, this._combinedQuat, combinedQuat, RA_INTENSITY);
    quat.normalize(this._combinedQuat, this._combinedQuat);

    const rad = Math.acos(this._combinedQuat[3]) * 2.0;
    const s = Math.sin(rad / 2.0);
    let rv = 0;
    if (s > 0.000001) {
      rv = rad / (2 * Math.PI);
      this.rotationAxis[0] = this._combinedQuat[0] / s;
      this.rotationAxis[1] = this._combinedQuat[1] / s;
      this.rotationAxis[2] = this._combinedQuat[2] / s;
    }

    const RV_INTENSITY = 0.5 * timeScale;
    this._rotationVelocity += (rv - this._rotationVelocity) * RV_INTENSITY;
    this.rotationVelocity = this._rotationVelocity / timeScale;

    this.updateCallback(deltaTime);
  }

  quatFromVectors(a, b, out, angleFactor = 1) {
    const axis = vec3.cross(vec3.create(), a, b);
    vec3.normalize(axis, axis);
    const d = Math.max(-1, Math.min(1, vec3.dot(a, b)));
    const angle = Math.acos(d) * angleFactor;
    quat.setAxisAngle(out, axis, angle);
    return { q: out, axis, angle };
  }

  #project(pos) {
    const r = 2;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const s = Math.max(w, h) - 1;

    const x = (2 * pos[0] - w - 1) / s;
    const y = (2 * pos[1] - h - 1) / s;
    let z = 0;
    const xySq = x * x + y * y;
    const rSq = r * r;

    if (xySq <= rSq / 2.0) {
      z = Math.sqrt(rSq - xySq);
    } else {
      z = rSq / Math.sqrt(xySq);
    }
    return vec3.fromValues(-x, y, z);
  }
}

class InfiniteGridMenu {
  TARGET_FRAME_DURATION = 1000 / 60;
  SPHERE_RADIUS = 2;

  #time = 0;
  #deltaTime = 0;
  #deltaFrames = 0;
  #frames = 0;

  camera = {
    matrix: mat4.create(),
    near: 0.1,
    far: 40,
    fov: Math.PI / 4,
    aspect: 1,
    position: vec3.fromValues(0, 0, 3),
    up: vec3.fromValues(0, 1, 0),
    matrices: {
      view: mat4.create(),
      projection: mat4.create(),
      inversProjection: mat4.create()
    }
  };

  nearestVertexIndex = null;
  smoothRotationVelocity = 0;
  scaleFactor = 1.0;
  movementActive = false;
  activeDiscIndex = -1;
  spinAngle = 0;
  spinning = false;
  // 手动选曲时的目标顶点；>=0 表示正在吸附旋转，期间抑制 onActiveItemChange
  #manualSnapVertex = -1;

  constructor(canvas, items, onActiveItemChange, onMovementChange, onInit = null, scale = 1.0) {
    this.canvas = canvas;
    this.items = items || [];
    this.onActiveItemChange = onActiveItemChange || (() => {});
    this.onMovementChange = onMovementChange || (() => {});
    this.scaleFactor = scale;
    this.camera.position[2] = 3 * scale;
    this.#init(onInit);
  }

  resize() {
    this.viewportSize = vec2.set(this.viewportSize || vec2.create(), this.canvas.clientWidth, this.canvas.clientHeight);

    const gl = this.gl;
    const needsResize = resizeCanvasToDisplaySize(gl.canvas);
    if (needsResize) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    this.#updateProjectionMatrix(gl);
  }

  run(time = 0) {
    this.#deltaTime = Math.min(32, time - this.#time);
    this.#time = time;
    this.#deltaFrames = this.#deltaTime / this.TARGET_FRAME_DURATION;
    this.#frames += this.#deltaFrames;

    this.#animate(this.#deltaTime);
    this.#render();

    requestAnimationFrame(t => this.run(t));
  }

  #init(onInit) {
    this.gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    const gl = this.gl;
    if (!gl) {
      throw new Error('No WebGL 2 context!');
    }

    this.viewportSize = vec2.fromValues(this.canvas.clientWidth, this.canvas.clientHeight);
    this.drawBufferSize = vec2.clone(this.viewportSize);

    this.discProgram = createProgram(gl, [discVertShaderSource, discFragShaderSource], null, {
      aModelPosition: 0,
      aModelNormal: 1,
      aModelUvs: 2,
      aInstanceMatrix: 3
    });

    this.discLocations = {
      aModelPosition: gl.getAttribLocation(this.discProgram, 'aModelPosition'),
      aModelUvs: gl.getAttribLocation(this.discProgram, 'aModelUvs'),
      aInstanceMatrix: gl.getAttribLocation(this.discProgram, 'aInstanceMatrix'),
      uWorldMatrix: gl.getUniformLocation(this.discProgram, 'uWorldMatrix'),
      uViewMatrix: gl.getUniformLocation(this.discProgram, 'uViewMatrix'),
      uProjectionMatrix: gl.getUniformLocation(this.discProgram, 'uProjectionMatrix'),
      uCameraPosition: gl.getUniformLocation(this.discProgram, 'uCameraPosition'),
      uScaleFactor: gl.getUniformLocation(this.discProgram, 'uScaleFactor'),
      uRotationAxisVelocity: gl.getUniformLocation(this.discProgram, 'uRotationAxisVelocity'),
      uTex: gl.getUniformLocation(this.discProgram, 'uTex'),
      uFrames: gl.getUniformLocation(this.discProgram, 'uFrames'),
      uItemCount: gl.getUniformLocation(this.discProgram, 'uItemCount'),
      uAtlasSize: gl.getUniformLocation(this.discProgram, 'uAtlasSize'),
      uActiveDisc: gl.getUniformLocation(this.discProgram, 'uActiveDisc'),
      uSpinAngle: gl.getUniformLocation(this.discProgram, 'uSpinAngle')
    };

    this.discGeo = new DiscGeometry(56, 1);
    this.discBuffers = this.discGeo.data;
    this.discVAO = makeVertexArray(
      gl,
      [
        [makeBuffer(gl, this.discBuffers.vertices, gl.STATIC_DRAW), this.discLocations.aModelPosition, 3],
        [makeBuffer(gl, this.discBuffers.uvs, gl.STATIC_DRAW), this.discLocations.aModelUvs, 2]
      ],
      this.discBuffers.indices
    );

    this.icoGeo = new IcosahedronGeometry();
    this.icoGeo.subdivide(1).spherize(this.SPHERE_RADIUS);
    this.instancePositions = this.icoGeo.vertices.map(v => v.position);
    this.DISC_INSTANCE_COUNT = this.icoGeo.vertices.length;
    this.#initDiscInstances(this.DISC_INSTANCE_COUNT);

    this.worldMatrix = mat4.create();
    this.#initTexture();

    this.control = new ArcballControl(this.canvas, deltaTime => this.#onControlUpdate(deltaTime));

    this.#updateCameraMatrix();
    this.#updateProjectionMatrix(gl);
    this.resize();

    if (onInit) onInit(this);
  }

  #initTexture() {
    const gl = this.gl;
    this.tex = createAndSetupTexture(gl, gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);

    const itemCount = Math.max(1, this.items.length);
    this.atlasSize = Math.ceil(Math.sqrt(itemCount));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const cellSize = 512;

    canvas.width = this.atlasSize * cellSize;
    canvas.height = this.atlasSize * cellSize;

    Promise.all(
      this.items.map(
        item =>
          new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.src = item.image;
          })
      )
    ).then(images => {
      images.forEach((img, i) => {
        const x = (i % this.atlasSize) * cellSize;
        const y = Math.floor(i / this.atlasSize) * cellSize;
        ctx.drawImage(img, x, y, cellSize, cellSize);
      });

      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
    });
  }

  #initDiscInstances(count) {
    const gl = this.gl;
    this.discInstances = {
      matricesArray: new Float32Array(count * 16),
      matrices: [],
      buffer: gl.createBuffer()
    };
    for (let i = 0; i < count; ++i) {
      const instanceMatrixArray = new Float32Array(this.discInstances.matricesArray.buffer, i * 16 * 4, 16);
      instanceMatrixArray.set(mat4.create());
      this.discInstances.matrices.push(instanceMatrixArray);
    }
    gl.bindVertexArray(this.discVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.discInstances.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.discInstances.matricesArray.byteLength, gl.DYNAMIC_DRAW);
    const mat4AttribSlotCount = 4;
    const bytesPerMatrix = 16 * 4;
    for (let j = 0; j < mat4AttribSlotCount; ++j) {
      const loc = this.discLocations.aInstanceMatrix + j;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, bytesPerMatrix, j * 4 * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
  }

  #animate(deltaTime) {
    const gl = this.gl;
    this.control.update(deltaTime, this.TARGET_FRAME_DURATION);

    // 播放时唱片缓慢自转（约 16 秒一圈）
    if (this.spinning) {
      this.spinAngle = (this.spinAngle + (deltaTime / 1000) * 0.4) % (Math.PI * 2);
    }

    let positions = this.instancePositions.map(p => vec3.transformQuat(vec3.create(), p, this.control.orientation));
    const scale = 0.25;
    const SCALE_INTENSITY = 0.6;
    positions.forEach((p, ndx) => {
      const s = (Math.abs(p[2]) / this.SPHERE_RADIUS) * SCALE_INTENSITY + (1 - SCALE_INTENSITY);
      const finalScale = s * scale;
      const matrix = mat4.create();
      mat4.multiply(matrix, matrix, mat4.fromTranslation(mat4.create(), vec3.negate(vec3.create(), p)));
      mat4.multiply(matrix, matrix, mat4.targetTo(mat4.create(), [0, 0, 0], p, [0, 1, 0]));
      mat4.multiply(matrix, matrix, mat4.fromScaling(mat4.create(), [finalScale, finalScale, finalScale]));
      mat4.multiply(matrix, matrix, mat4.fromTranslation(mat4.create(), [0, 0, -this.SPHERE_RADIUS]));

      mat4.copy(this.discInstances.matrices[ndx], matrix);
    });

    gl.bindBuffer(gl.ARRAY_BUFFER, this.discInstances.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.discInstances.matricesArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.smoothRotationVelocity = this.control.rotationVelocity;
  }

  #render() {
    const gl = this.gl;
    gl.useProgram(this.discProgram);

    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(this.discLocations.uWorldMatrix, false, this.worldMatrix);
    gl.uniformMatrix4fv(this.discLocations.uViewMatrix, false, this.camera.matrices.view);
    gl.uniformMatrix4fv(this.discLocations.uProjectionMatrix, false, this.camera.matrices.projection);
    gl.uniform3f(
      this.discLocations.uCameraPosition,
      this.camera.position[0],
      this.camera.position[1],
      this.camera.position[2]
    );
    gl.uniform4f(
      this.discLocations.uRotationAxisVelocity,
      this.control.rotationAxis[0],
      this.control.rotationAxis[1],
      this.control.rotationAxis[2],
      this.smoothRotationVelocity * 1.1
    );

    gl.uniform1i(this.discLocations.uItemCount, this.items.length);
    gl.uniform1i(this.discLocations.uAtlasSize, this.atlasSize);
    gl.uniform1i(this.discLocations.uActiveDisc, this.activeDiscIndex);
    gl.uniform1f(this.discLocations.uSpinAngle, this.spinAngle);

    gl.uniform1f(this.discLocations.uFrames, this.#frames);
    gl.uniform1f(this.discLocations.uScaleFactor, this.scaleFactor);
    gl.uniform1i(this.discLocations.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.discVAO);
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      this.discBuffers.indices.length,
      gl.UNSIGNED_SHORT,
      0,
      this.DISC_INSTANCE_COUNT
    );
  }

  #updateCameraMatrix() {
    mat4.targetTo(this.camera.matrix, this.camera.position, [0, 0, 0], this.camera.up);
    mat4.invert(this.camera.matrices.view, this.camera.matrix);
  }

  #updateProjectionMatrix(gl) {
    this.camera.aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const height = this.SPHERE_RADIUS * 0.35;
    const distance = this.camera.position[2];
    if (this.camera.aspect > 1) {
      this.camera.fov = 2 * Math.atan(height / distance);
    } else {
      this.camera.fov = 2 * Math.atan(height / this.camera.aspect / distance);
    }
    mat4.perspective(
      this.camera.matrices.projection,
      this.camera.fov,
      this.camera.aspect,
      this.camera.near,
      this.camera.far
    );
    mat4.invert(this.camera.matrices.inversProjection, this.camera.matrices.projection);
  }

  #onControlUpdate(deltaTime) {
    const timeScale = deltaTime / this.TARGET_FRAME_DURATION + 0.0001;
    let damping = 5 / timeScale;
    let cameraTargetZ = 3 * this.scaleFactor;

    const isMoving = this.control.isPointerDown || Math.abs(this.smoothRotationVelocity) > 0.01;

    if (isMoving !== this.movementActive) {
      this.movementActive = isMoving;
      this.onMovementChange(isMoving);
    }

    if (!this.control.isPointerDown) {
      if (this.#manualSnapVertex >= 0) {
        // 手动选曲吸附：旋转到目标唱片，期间不触发 onActiveItemChange
        this.activeDiscIndex = this.#manualSnapVertex;
        const snapDirection = vec3.normalize(vec3.create(), this.#getVertexWorldPosition(this.#manualSnapVertex));
        this.control.snapTargetDirection = snapDirection;
        // 接近目标后结束手动吸附，恢复正常吸附并触发一次激活变更
        if (vec3.dot(snapDirection, this.control.snapDirection) > 0.99) {
          const itemIndex = this.#manualSnapVertex % Math.max(1, this.items.length);
          this.onActiveItemChange(itemIndex);
          this.#manualSnapVertex = -1;
        }
      } else {
        const nearestVertexIndex = this.#findNearestVertexIndex();
        this.activeDiscIndex = nearestVertexIndex;
        const itemIndex = nearestVertexIndex % Math.max(1, this.items.length);
        this.onActiveItemChange(itemIndex);
        const snapDirection = vec3.normalize(vec3.create(), this.#getVertexWorldPosition(nearestVertexIndex));
        this.control.snapTargetDirection = snapDirection;
      }
    } else {
      // 用户开始拖动时取消手动吸附
      this.#manualSnapVertex = -1;
      cameraTargetZ += this.control.rotationVelocity * 80 + 2.5;
      damping = 7 / timeScale;
    }

    this.camera.position[2] += (cameraTargetZ - this.camera.position[2]) / damping;
    this.#updateCameraMatrix();
  }

  #findNearestVertexIndex() {
    const n = this.control.snapDirection;
    const inversOrientation = quat.conjugate(quat.create(), this.control.orientation);
    const nt = vec3.transformQuat(vec3.create(), n, inversOrientation);

    let maxD = -1;
    let nearestVertexIndex;
    for (let i = 0; i < this.instancePositions.length; ++i) {
      const d = vec3.dot(nt, this.instancePositions[i]);
      if (d > maxD) {
        maxD = d;
        nearestVertexIndex = i;
      }
    }
    return nearestVertexIndex;
  }

  #getVertexWorldPosition(index) {
    const nearestVertexPos = this.instancePositions[index];
    return vec3.transformQuat(vec3.create(), nearestVertexPos, this.control.orientation);
  }

  /** 旋转球体使映射到 itemIndex 的唱片朝向相机 */
  snapToItem(itemIndex) {
    const count = Math.max(1, this.items.length);
    const n = this.control.snapDirection;
    // 选当前最接近朝向相机的同 item 顶点，让旋转距离最短
    let best = -1;
    let bestD = -2;
    for (let i = 0; i < this.instancePositions.length; ++i) {
      if (i % count !== itemIndex) continue;
      const wp = this.#getVertexWorldPosition(i);
      const d = vec3.dot(vec3.normalize(vec3.create(), wp), n);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    this.#manualSnapVertex = best;
  }
}

const defaultItems = [
  {
    image: 'https://picsum.photos/900/900?grayscale',
    title: '',
    artist: ''
  }
];

/** 秒数格式化为 m:ss */
function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 解析 LRC 歌词文件，返回按时间排序的 [{ time, text }] 数组
 * @param {string} lrcText
 */
function parseLrc(lrcText) {
  const entries = [];
  const tagRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  lrcText.split(/\r?\n/).forEach(line => {
    const matches = [...line.matchAll(tagRe)];
    if (!matches.length) return;
    const text = line.replace(tagRe, '').trim();
    matches.forEach(m => {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      entries.push({ time: minutes * 60 + seconds + ms / 1000, text });
    });
  });
  return entries.sort((a, b) => a.time - b.time);
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/**
 * 提取图片主色调（hue，0-360）。忽略低饱和、过暗、过亮的像素，
 * 其余按 饱和度×亮度 加权统计色相直方图，取权重最大的色相区间中心值。
 * @param {string} imageSrc
 * @returns {Promise<number|null>}
 */
function extractDominantHue(imageSrc) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const bins = 36;
        const histogram = new Array(bins).fill(0);
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, v] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
          if (v < 0.15 || v > 0.95 || s < 0.18) continue;
          const bin = Math.min(bins - 1, Math.floor((h / 360) * bins));
          const w = s * v;
          histogram[bin] += w;
          total += w;
        }
        if (!total) {
          resolve(null);
          return;
        }
        let maxBin = 0;
        for (let i = 1; i < bins; i++) if (histogram[i] > histogram[maxBin]) maxBin = i;
        resolve(((maxBin + 0.5) / bins) * 360);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageSrc;
  });
}

/**
 * @typedef {Object} InfiniteMenuItem
 * @property {string} image
 * @property {string} [title]
 * @property {string} [artist]
 * @property {string} [audio]
 * @property {string} [lrc]
 */

/**
 * @param {Object} props
 * @param {InfiniteMenuItem[]} [props.items]
 * @param {number} [props.scale]
 * @param {string} [props.audioSrc]
 * @param {string} [props.lrcSrc]
 */
export default function InfiniteMenu({ items = [], scale = 1.0, audioSrc, lrcSrc, onPlayingChange, onColorChange, onMovementChange }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const lyricsRef = useRef([]);
  const lyricsPanelRef = useRef(null);
  const lyricLineRefs = useRef([]);
  const [activeItem, setActiveItem] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);
  const [lineHeights, setLineHeights] = useState([]);
  const [panelHeight, setPanelHeight] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressTrackRef = useRef(null);
  const sketchRef = useRef(null);
  const videoRef = useRef(null);
  // 记录上一次球体吸附到的唱片下标，避免每帧重复触发 setPlaylistIndex(null) 覆盖手动选曲
  const lastActiveIndexRef = useRef(-1);
  // 用 ref 持有最新的 onMovementChange，避免其变化导致 sketch 重建
  const onMovementChangeRef = useRef(onMovementChange);
  useEffect(() => {
    onMovementChangeRef.current = onMovementChange;
  });
  const [gestureOn, setGestureOn] = useState(false);
  const [gestureStatus, setGestureStatus] = useState('off');
  // 播放列表手动选曲索引；为 null 时跟随球体激活唱片
  const [playlistIndex, setPlaylistIndex] = useState(null);
  // 播放模式：loop 列表循环 / one 单曲循环 / shuffle 随机播放
  const [playMode, setPlayMode] = useState('loop');
  const [volume, setVolume] = useState(0.8);
  const lastVolumeRef = useRef(0.8);

  // 播放列表：带音频的唱片项
  const playlist = items.filter(it => it.audio);
  // 当前歌曲：手动选曲优先，其次激活唱片自带的 audio/lrc，兼容组件级 audioSrc/lrcSrc
  const followSong = activeItem && activeItem.audio ? activeItem : audioSrc ? { audio: audioSrc, lrc: lrcSrc } : null;
  const song = playlistIndex != null && playlist.length ? playlist[playlistIndex] : followSong;
  const currentAudio = song?.audio || null;
  const currentLrc = song?.lrc || null;
  const isPlayingRef = useRef(false);
  const playModeRef = useRef(playMode);
  // 保存最新切歌函数，供 audio ended 回调使用
  const advanceRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let sketch;

    const handleActiveItem = index => {
      const itemIndex = index % items.length;
      // 仅当吸附到的唱片真正变化时才更新，否则每帧都会把手动选曲覆盖为 null
      if (itemIndex === lastActiveIndexRef.current) return;
      lastActiveIndexRef.current = itemIndex;
      setActiveItem(items[itemIndex]);
      // 球体转动切换激活唱片时，取消手动选曲，恢复跟随球体
      setPlaylistIndex(null);
    };

    // 拖动状态变化时同时通知父组件（用于背景塌陷等效果）
    const handleMovementChange = isMoving => {
      setIsMoving(isMoving);
      onMovementChangeRef.current?.(isMoving);
    };

    if (canvas) {
      sketch = new InfiniteGridMenu(
        canvas,
        items.length ? items : defaultItems,
        handleActiveItem,
        handleMovementChange,
        sk => sk.run(),
        scale
      );
      sketchRef.current = sketch;
    }

    const handleResize = () => {
      if (sketch) {
        sketch.resize();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [items, scale]);

  // 播放/暂停时同步唱片自转状态
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (sketchRef.current) {
      sketchRef.current.spinning = isPlaying;
    }
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // 播放模式同步到 ref，供 audio 事件回调读取最新值
  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  // 切换激活唱片时，提取封面主色调通知父组件，用于背景星空配色
  useEffect(() => {
    if (!activeItem?.image) return;
    let cancelled = false;
    extractDominantHue(activeItem.image).then(hue => {
      if (!cancelled && hue != null) onColorChange?.(hue);
    });
    return () => {
      cancelled = true;
    };
  }, [activeItem, onColorChange]);

  // 切换歌曲：暂停时仅换源，播放中换源后继续播放新歌
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentAudio) return;
    setCurrentTime(0);
    setDuration(0);
    setActiveLyricIndex(0);
    if (isPlayingRef.current) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [currentAudio]);

  useEffect(() => {
    lyricsRef.current = [];
    setLyrics([]);
    if (!currentLrc) return;
    let cancelled = false;
    fetch(currentLrc)
      .then(res => res.text())
      .then(text => {
        if (!cancelled) {
          const parsed = parseLrc(text);
          lyricsRef.current = parsed;
          setLyrics(parsed);
        }
      })
      .catch(err => console.error('Failed to load lyrics:', err));
    return () => {
      cancelled = true;
    };
  }, [currentLrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      const t = audio.currentTime;
      setCurrentTime(t);
      const list = lyricsRef.current;
      let index = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].time <= t) {
          index = i;
        } else {
          break;
        }
      }
      setActiveLyricIndex(prev => (prev === index ? prev : index));
    };
    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleEnded = () => {
      if (playModeRef.current === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => setIsPlaying(false));
        return;
      }
      advanceRef.current?.(1);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    // 浏览器缓存可能导致元数据在挂载监听前已加载完成，此时立即同步一次
    if (audio.readyState >= 1) {
      handleLoadedMetadata();
    }
    setCurrentTime(audio.currentTime || 0);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
    };
  }, []);

  // 歌词换行后每行高度不固定，渲染完成后实际测量各行与面板高度，窗口尺寸变化时重新测量
  useEffect(() => {
    if (!lyrics.length) return;

    const measure = () => {
      setLineHeights(lyrics.map((_, i) => lyricLineRefs.current[i]?.offsetHeight || 36));
      setPanelHeight(lyricsPanelRef.current?.clientHeight || 0);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [lyrics]);

  // 手势控制：握拳 = 抓取拖动，移动拳头 = 旋转球体，张手 = 释放并播放
  useEffect(() => {
    if (!gestureOn) return;

    let cancelled = false;
    let landmarker = null;
    let stream = null;
    let rafId = 0;
    const video = videoRef.current;

    const CONFIRM_FRAMES = 3; // 手势状态切换需连续确认的帧数，防抖
    let grabbing = false;
    let fistFrames = 0;
    let openFrames = 0;
    let smoothX = null;
    let smoothY = null;
    let lastStatus = '';

    const reportStatus = s => {
      if (s !== lastStatus) {
        lastStatus = s;
        setGestureStatus(s);
      }
    };

    const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

    // 依据 4 根手指（食/中/无名/小）指尖与指根到手腕的距离比判断握拳/张手
    const classify = lm => {
      const wrist = lm[0];
      const fingers = [
        [8, 6],
        [12, 10],
        [16, 14],
        [20, 18]
      ];
      let curled = 0;
      let extended = 0;
      for (const [tip, pip] of fingers) {
        const ratio = dist3(lm[tip], wrist) / (dist3(lm[pip], wrist) + 1e-6);
        if (ratio < 1.05) curled++;
        else if (ratio > 1.35) extended++;
      }
      if (curled >= 3) return 'fist';
      if (extended >= 3) return 'open';
      return 'unknown';
    };

    // 张手释放后：若未在播放则开始播放
    const playAudio = () => {
      const audio = audioRef.current;
      if (audio && audio.paused) {
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      }
    };

    const handleResult = result => {
      const control = sketchRef.current?.control;
      const canvas = canvasRef.current;
      const lm = result?.landmarks?.[0];

      if (!lm) {
        fistFrames = 0;
        openFrames = 0;
        if (grabbing) {
          grabbing = false;
          control?.externalUp();
        }
        reportStatus('no-hand');
        return;
      }

      // 掌心位置：手腕 + 四指掌根平均，比单点更稳
      let px = 0;
      let py = 0;
      for (const i of [0, 5, 9, 13, 17]) {
        px += lm[i].x;
        py += lm[i].y;
      }
      px /= 5;
      py /= 5;

      // 镜像映射到画布 client 坐标，并做指数平滑
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + (1 - px) * rect.width;
      const cy = rect.top + py * rect.height;
      smoothX = smoothX == null ? cx : smoothX + (cx - smoothX) * 0.45;
      smoothY = smoothY == null ? cy : smoothY + (cy - smoothY) * 0.45;

      const g = classify(lm);
      if (g === 'fist') {
        fistFrames++;
        openFrames = 0;
      } else if (g === 'open') {
        openFrames++;
        fistFrames = 0;
      } else {
        fistFrames = 0;
        openFrames = 0;
      }

      if (!grabbing) {
        if (fistFrames >= CONFIRM_FRAMES) {
          grabbing = true;
          fistFrames = 0;
          control?.externalDown(smoothX, smoothY);
          reportStatus('fist');
        } else {
          reportStatus('open');
        }
      } else {
        control?.externalMove(smoothX, smoothY);
        if (openFrames >= CONFIRM_FRAMES) {
          grabbing = false;
          openFrames = 0;
          control?.externalUp();
          reportStatus('open');
          playAudio();
        }
      }
    };

    const setup = async () => {
      try {
        reportStatus('loading');
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks('/vision_wasm');
        const createOptions = delegate => ({
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numHands: 1
        });
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, createOptions('GPU'));
        } catch {
          landmarker = await HandLandmarker.createFromOptions(vision, createOptions('CPU'));
        }
        if (cancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        let lastVideoTime = -1;
        const loop = () => {
          if (cancelled) return;
          rafId = requestAnimationFrame(loop);
          if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          handleResult(landmarker.detectForVideo(video, performance.now()));
        };
        reportStatus('no-hand');
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.error('手势控制初始化失败:', err);
        reportStatus('error');
      }
    };

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach(t => t.stop());
      landmarker?.close();
      if (video) video.srcObject = null;
      sketchRef.current?.control?.externalUp();
      lastStatus = '';
      setGestureStatus('off');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureOn]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  // 当前曲目在播放列表中的下标（跟随球体时按激活唱片匹配）
  const currentPlaylistIndex = () => {
    const idx = playlist.findIndex(p => p === followSong);
    return idx >= 0 ? idx : 0;
  };

  // 切歌：dir 为 1 下一曲 / -1 上一曲；随机模式下自动随机挑选
  const advanceTrack = dir => {
    if (!playlist.length) return;
    const base = playlistIndex != null ? playlistIndex : currentPlaylistIndex();
    let next;
    if (playModeRef.current === 'shuffle' && dir === 1) {
      if (playlist.length === 1) return;
      do {
        next = Math.floor(Math.random() * playlist.length);
      } while (next === base);
    } else {
      next = (base + dir + playlist.length) % playlist.length;
    }
    setPlaylistIndex(next);
    const songItem = playlist[next];
    // 立即更新标题/歌手/封面色调，与音频歌词同步切换
    setActiveItem(songItem);
    // 重置吸附去重，让旋转到位后能正常触发 handleActiveItem
    lastActiveIndexRef.current = -1;
    // 旋转球体到对应唱片，让 3D 唱片也切换
    const itemsIndex = items.indexOf(songItem);
    if (itemsIndex >= 0) sketchRef.current?.snapToItem(itemsIndex);
    // 切歌后立即播放（currentAudio 变化时由副作用接管播放）
    isPlayingRef.current = true;
    setIsPlaying(true);
  };

  // 供 audio ended 回调拿到最新的切歌函数
  useEffect(() => {
    advanceRef.current = advanceTrack;
  });

  // 播放模式循环切换：列表循环 → 单曲循环 → 随机播放
  const cyclePlayMode = () => {
    setPlayMode(m => (m === 'loop' ? 'one' : m === 'one' ? 'shuffle' : 'loop'));
  };

  // 音量同步到 audio 元素
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 点击喇叭：静音 / 恢复之前音量
  const toggleMute = () => {
    if (volume > 0) {
      lastVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.8);
    }
  };

  // 点击或拖动进度条跳转播放位置
  const handleProgressPointerDown = e => {
    const audio = audioRef.current;
    const track = progressTrackRef.current;
    const total = duration || audio?.duration || 0;
    if (!audio || !track || !total) return;

    const seekTo = clientX => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * total;
      setCurrentTime(audio.currentTime);
    };

    seekTo(e.clientX);
    const handleMove = ev => seekTo(ev.clientX);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  // 点击或拖动歌词跳转播放位置
  const handleLyricPointerDown = e => {
    const audio = audioRef.current;
    const list = lyricsRef.current;
    if (!audio || !list.length) return;

    // 阻止默认行为（文本选择/原生拖拽），否则 pointermove 会被中断
    e.preventDefault();
    // 捕获指针，确保拖出元素后仍能收到 pointermove / pointerup
    const target = e.currentTarget;
    if (target.setPointerCapture) {
      try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    // 找到 clientY 落在哪一行的区间内
    const findLineAtY = clientY => {
      let idx = 0;
      for (let i = 0; i < list.length; i++) {
        const el = lyricLineRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientY >= rect.top) {
          idx = i;
        } else {
          break;
        }
      }
      return idx;
    };

    const seekToIndex = idx => {
      const t = list[idx].time;
      audio.currentTime = t;
      setCurrentTime(t);
      setActiveLyricIndex(idx);
    };

    // 点击：跳到指针所在行
    seekToIndex(findLineAtY(e.clientY));

    // 拖动：以相对偏移 seek（反向，拖下=往前，拖上=往后，像抓着歌词拽）
    const startY = e.clientY;
    const startTime = audio.currentTime;
    const totalPixels = lineHeights.reduce((s, h) => s + h, 0) || 1;
    const totalTime = list.length > 1 ? list[list.length - 1].time - list[0].time : 1;
    const pxToTime = totalTime / totalPixels;

    const handleMove = ev => {
      ev.preventDefault();
      const delta = ev.clientY - startY; // 拖下为正
      const newTime = Math.max(0, Math.min(duration || audio.duration || 9999, startTime - delta * pxToTime));
      audio.currentTime = newTime;
      setCurrentTime(newTime);
      // 同步高亮行
      let idx = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].time <= newTime) idx = i;
        else break;
      }
      setActiveLyricIndex(idx);
    };
    const handleUp = ev => {
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      if (target.releasePointerCapture && ev?.pointerId != null) {
        try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
    };
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas id="infinite-grid-menu-canvas" ref={canvasRef} />

      <audio ref={audioRef} src={currentAudio || undefined} preload="auto" />

      {activeItem && (
        <>
          <h2 className={`face-title ${isMoving ? 'inactive' : 'active'}`}>{activeItem.title}</h2>

          <p className={`face-artist ${isMoving ? 'inactive' : 'active'}`}>{activeItem.artist}</p>
        </>
      )}

      {lyrics.length > 0 && (
        <div ref={lyricsPanelRef} className={`lyrics-panel ${isMoving ? 'inactive' : 'active'}`}>
          <div
            className="lyrics-track"
            style={{
              transform: `translateY(${(panelHeight / 2 - (lineHeights.slice(0, activeLyricIndex).reduce((sum, h) => sum + h, 0) + (lineHeights[activeLyricIndex] || 0) / 2)).toFixed(1)}px)`
            }}
            onPointerDown={handleLyricPointerDown}
          >
            {lyrics.map((line, i) => (
              <p
                key={i}
                ref={el => (lyricLineRefs.current[i] = el)}
                className={`lyric-line${i === activeLyricIndex ? ' current' : Math.abs(i - activeLyricIndex) === 1 ? ' near' : ''}`}
              >
                {line.text || ' '}
              </p>
            ))}
          </div>
        </div>
      )}

      {currentAudio && (
        <div className={`player-bar ${isMoving ? 'inactive' : 'active'}`}>
          <div className="player-controls">
            <button
              type="button"
              className={`player-icon-button${playMode !== 'loop' ? ' on' : ''}`}
              onClick={cyclePlayMode}
              aria-label={{ loop: '列表循环', one: '单曲循环', shuffle: '随机播放' }[playMode]}
              title={{ loop: '列表循环', one: '单曲循环', shuffle: '随机播放' }[playMode]}
            >
              {playMode === 'shuffle' ? (
                <svg viewBox="0 0 24 24">
                  <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                </svg>
              ) : playMode === 'one' ? (
                <svg viewBox="0 0 24 24">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                </svg>
              )}
            </button>

            <button type="button" className="player-icon-button" onClick={() => advanceTrack(-1)} aria-label="上一曲">
              <svg viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>

            <button
              type="button"
              className="player-play-button"
              onClick={togglePlay}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="play-icon">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button type="button" className="player-icon-button" onClick={() => advanceTrack(1)} aria-label="下一曲">
              <svg viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" />
              </svg>
            </button>

            <div className="volume-control">
              <button
                type="button"
                className="player-icon-button"
                onClick={toggleMute}
                aria-label={volume === 0 ? '取消静音' : '静音'}
              >
                {volume === 0 ? (
                  <svg viewBox="0 0 24 24">
                    <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="volume-slider"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                aria-label="音量"
              />
            </div>
          </div>

          <div className="player-progress">
            <span className="progress-time">{formatTime(currentTime)}</span>
            <div ref={progressTrackRef} className="progress-track" onPointerDown={handleProgressPointerDown}>
              <div className="progress-rail" />
              <div className="progress-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
            </div>
            <span className="progress-time">{formatTime(duration)}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`gesture-toggle${gestureOn ? ' on' : ''}`}
        onClick={() => setGestureOn(v => !v)}
      >
        {gestureOn ? '关闭手势' : '手势控制'}
      </button>

      {gestureOn && (
        <div className="gesture-preview">
          <video ref={videoRef} autoPlay playsInline muted />
          <span className={`gesture-status ${gestureStatus}`}>
            {
              {
                loading: '模型加载中…',
                'no-hand': '请露出手掌',
                open: '张手 · 握拳抓取',
                fist: '抓取中 · 张手播放',
                error: '初始化失败'
              }[gestureStatus] || '准备中…'
            }
          </span>
        </div>
      )}
    </div>
  );
}
