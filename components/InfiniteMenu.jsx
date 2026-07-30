'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mat4, quat, vec2, vec3 } from 'gl-matrix';
import './InfiniteMenu.css';

const discVertShaderSource = `#version 300 es

precision highp float;
precision highp int;

uniform mat4 uWorldMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform vec3 uCameraPosition;
uniform vec4 uRotationAxisVelocity;
uniform int uActiveDisc;
uniform int uPreviousDisc;
uniform int uDragPreviewDisc;
uniform float uSwitchProgress;
uniform float uAutoSwitching;
uniform float uDragging;
uniform float uDragCommitProgress;
uniform vec2 uDragOffset;
uniform vec2 uFocusNdcScale;
uniform float uGrabProgress;

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
    float isActive = gl_InstanceID == uActiveDisc ? 1.0 : 0.0;
    float isPrevious = gl_InstanceID == uPreviousDisc ? 1.0 : 0.0;
    float isDragPreview = gl_InstanceID == uDragPreviewDisc ? 1.0 : 0.0;
    float isAutoFocus = max(
      max(isActive, isPrevious) * uAutoSwitching,
      max(isActive, isDragPreview) * uDragging
    );

    // 自动切歌的两颗焦点星球已有独立时间线，不再叠加旋转拉伸，避免轮廓逐帧抖动。
    if (gl_VertexID > 0 && isAutoFocus < 0.5) {
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

    // 切歌不是“瞬间换皮”：旧星球向左上退入深空，新星球从右下靠近主舞台。
    // 切换期间使用固定镜头锚点，避免底层球体旋转把星球过早甩出画面。
    // 只有按钮/程序触发的切歌才使用固定镜头锚点。
    // 手势拖动时必须跟随球体本身，否则中心星球会像被钉在屏幕上一样。
    float isSwitching = uAutoSwitching;
    float switchEase = uSwitchProgress * uSwitchProgress * (3.0 - 2.0 * uSwitchProgress);
    vec4 centerClip = uProjectionMatrix * uViewMatrix * vec4(centerPos, 1.0);
    vec2 centerNdc = centerClip.xy / max(0.0001, centerClip.w);
    vec2 vertexNdc = gl_Position.xy / max(0.0001, gl_Position.w);
    vec2 localNdc = vertexNdc - centerNdc;
    // 切换中的焦点星球使用固定的屏幕尺寸。
    // aModelPosition 是星球自身的圆形坐标，不会被底层球面旋转、透视远近或实例缩放带着跳动。
    vec2 stableLocalNdc = aModelPosition.xy * uFocusNdcScale;
    // 鼠标长按和握拳抓取共用同一个后缩进度。
    vec2 grabbedLocalNdc = stableLocalNdc * mix(1.0, 0.84, uGrabProgress);

    // 旧星球必须从点击前的中心位置起步，否则第一帧会发生明显瞬移。
    vec2 previousAnchor = mix(vec2(0.0), vec2(-0.48, 0.10), switchEase);
    vec2 activeAnchor = mix(vec2(0.42, -0.08), vec2(0.0), switchEase);
    // 按钮切歌只改变位置，不改变星球大小，避免出现“先小后大”的呼吸感。
    float previousScale = 1.0;
    float activeScale = 1.0;
    vec2 previousNdc = previousAnchor + stableLocalNdc * previousScale;
    vec2 activeNdc = activeAnchor + stableLocalNdc * activeScale;
    vec2 transitionNdc = mix(
      vertexNdc,
      previousNdc,
      isPrevious * isSwitching
    );
    transitionNdc = mix(
      transitionNdc,
      activeNdc,
      isActive * isSwitching
    );

    // 两颗星球共用同一条连续轨道：当前星球跟手离场，候选星球从反方向同步进场。
    // 不限制 uDragOffset，指针移出画布后星球仍会继续移动，不会在边缘“撞墙”。
    float dragLength = length(uDragOffset);
    float dragTrackLength = 1.08;
    float dragAmount = smoothstep(0.0, 1.0, clamp(dragLength / dragTrackLength, 0.0, 1.0));
    vec2 dragDirection = dragLength > 0.0001 ? normalize(uDragOffset) : vec2(-1.0, 0.0);
    vec2 activeDragNdc =
      uDragOffset + grabbedLocalNdc * mix(1.0, 0.78, dragAmount);
    vec2 previewTrackAnchor = uDragOffset - dragDirection * dragTrackLength;
    // 成功切歌时，下一颗星球从当前位置继续向中心收尾；
    // 当前星球仍沿原方向离场，不再反向拉回固定点。
    vec2 previewAnchor = mix(previewTrackAnchor, vec2(0.0), uDragCommitProgress);
    float dragPreviewScale = mix(
      mix(0.78, 1.0, dragAmount),
      1.0,
      uDragCommitProgress
    );
    vec2 dragPreviewNdc =
      previewAnchor + grabbedLocalNdc * dragPreviewScale;
    transitionNdc = mix(
      transitionNdc,
      dragPreviewNdc,
      isDragPreview * uDragging
    );
    transitionNdc = mix(
      transitionNdc,
      activeDragNdc,
      isActive * uDragging
    );
    gl_Position.xy = transitionNdc * gl_Position.w;

    // 旧星球前半程保持可见，后半程才真正落入更深的空间层。
    float previousDepth = mix(0.0, 0.060, switchEase);
    gl_Position.z += isPrevious * isSwitching * previousDepth * gl_Position.w;
    // 拖动预览固定在前景层，中央当前星球略靠前，避免透明星球互相穿插闪烁。
    gl_Position.z = mix(gl_Position.z, -0.010 * gl_Position.w, isDragPreview * uDragging);
    gl_Position.z = mix(gl_Position.z, -0.018 * gl_Position.w, isActive * uDragging);

    // 焦点星球已经走独立的屏幕轨道，透明度也必须脱离底层球面深度。
    // 否则松手提交后，候选星球会先随背面深度变暗，再在吸附到正面时突然亮回。
    float depthAlpha = smoothstep(0.5, 1., normalize(worldPosition.xyz).z) * .9 + .1;
    vAlpha = mix(depthAlpha, 1.0, isAutoFocus);
    vUvs = aModelUvs;
    vInstanceId = gl_InstanceID;
}
`;

const discFragShaderSource = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTex;
uniform sampler2D uSurfaceTex;
uniform int uItemCount;
uniform int uAtlasSize;
uniform int uActiveDisc;
uniform int uPreviousDisc;
uniform int uDragPreviewDisc;
uniform float uFrames;
uniform float uSpinAngle;
uniform float uSurroundingVisibility;
uniform float uSwitchProgress;
uniform float uAutoSwitching;
uniform float uDragging;
uniform float uAudioBass;
uniform float uAudioMid;
uniform float uAudioTreble;

out vec4 outColor;

in vec2 vUvs;
in float vAlpha;
flat in int vInstanceId;

#define PI 3.141593

float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
    for (int octave = 0; octave < 4; octave++) {
        sum += valueNoise(p) * amplitude;
        p = rotation * p * 2.03 + vec2(1.7, -2.4);
        amplitude *= 0.5;
    }
    return sum;
}

void main() {
    int itemIndex = vInstanceId % uItemCount;
    int cellsPerRow = uAtlasSize;
    int cellX = itemIndex % cellsPerRow;
    int cellY = itemIndex / cellsPerRow;
    vec2 cellSize = vec2(1.0) / vec2(float(cellsPerRow));
    vec2 cellOffset = vec2(float(cellX), float(cellY)) * cellSize;

    // 以圆心为原点，r = 1 对应音乐星球边缘
    vec2 pRaw = vUvs - 0.5;
    float r = length(pRaw) * 2.0;
    float aa = max(0.006, fwidth(r) * 1.5);
    if (r > 1.0 + aa) {
        discard;
    }

    float isActive = vInstanceId == uActiveDisc ? 1.0 : 0.0;
    float isPrevious = vInstanceId == uPreviousDisc ? 1.0 : 0.0;
    float isDragPreview = vInstanceId == uDragPreviewDisc ? 1.0 : 0.0;
    float previousFade = 1.0 - smoothstep(0.28, 0.82, uSwitchProgress);
    float previousVisibility = isPrevious * previousFade;
    float dragPreviewVisibility = isDragPreview * uDragging * 0.82;
    float distantVisibility = max(
      max(uSurroundingVisibility * 0.42, previousVisibility),
      dragPreviewVisibility
    );
    float activeEntrance = mix(1.0, smoothstep(0.04, 0.48, uSwitchProgress), uAutoSwitching);
    float instanceVisibility = mix(distantVisibility, activeEntrance, isActive);
    if (instanceVisibility < 0.002) {
        discard;
    }

    // 圆形网格只负责轮廓，法线在片元阶段重建，让星球拥有连续的球面明暗。
    vec2 sphereXY = pRaw * 2.0;
    float sphereZ = sqrt(max(0.0, 1.0 - dot(sphereXY, sphereXY)));
    vec3 sphereNormal = normalize(vec3(sphereXY, sphereZ));

    // 所有星球共享同一条连续相位。切歌时 active 身份虽然会改变，
    // 但球面纹理不会因此重新计算到另一位置，旧球与新球交接时不再闪跳。
    float ambientSpin = uFrames * 0.000015;
    float spinOffset = ambientSpin + uSpinAngle * 0.012;
    float longitude = atan(sphereNormal.x, max(0.0001, sphereNormal.z)) / PI + 0.5;
    float latitude = 0.5 - asin(clamp(sphereNormal.y, -1.0, 1.0)) / PI;
    vec2 planetUv = vec2(longitude + spinOffset, latitude);

    // 从封面的不同区域取色。最深的颜色成为岩层色，最亮的颜色成为云层和晶体高光。
    vec3 swatchA = texture(uTex, cellOffset + vec2(0.16, 0.20) * cellSize).rgb;
    vec3 swatchB = texture(uTex, cellOffset + vec2(0.78, 0.24) * cellSize).rgb;
    vec3 swatchC = texture(uTex, cellOffset + vec2(0.30, 0.72) * cellSize).rgb;
    vec3 swatchD = texture(uTex, cellOffset + vec2(0.74, 0.76) * cellSize).rgb;
    vec3 pigment = swatchA;
    if (luminance(swatchB) < luminance(pigment)) pigment = swatchB;
    if (luminance(swatchC) < luminance(pigment)) pigment = swatchC;
    if (luminance(swatchD) < luminance(pigment)) pigment = swatchD;
    vec3 brightSwatch = swatchA;
    if (luminance(swatchB) > luminance(brightSwatch)) brightSwatch = swatchB;
    if (luminance(swatchC) > luminance(brightSwatch)) brightSwatch = swatchC;
    if (luminance(swatchD) > luminance(brightSwatch)) brightSwatch = swatchD;

    float pigmentPeak = max(max(pigment.r, pigment.g), pigment.b);
    vec3 pigmentHue = pigment / max(0.12, pigmentPeak);
    pigmentHue = mix(vec3(0.18, 0.32, 0.52), pigmentHue, smoothstep(0.05, 0.28, pigmentPeak));
    // 封面只决定材质色系，不把高饱和像素直接印到球壳上。
    // 稍微去饱和后更接近岩石、冰层和矿物的真实反射。
    float pigmentLuma = luminance(pigmentHue);
    pigmentHue = mix(vec3(pigmentLuma), pigmentHue, 0.58);
    vec3 deepColor = mix(vec3(0.012, 0.020, 0.060), pigmentHue * 0.19, 0.72);
    vec3 middleColor = mix(deepColor, pigmentHue * 0.68 + vec3(0.025, 0.045, 0.090), 0.72);
    vec3 crystalColor = mix(brightSwatch * 0.72, vec3(0.46, 0.72, 0.92), 0.24);
    vec3 magicGlow = mix(crystalColor, vec3(0.22, 0.68, 0.86), 0.34);

    // 取色仍然保留，但不只拿来整片染色。
    // 封面的明暗、对比度和色彩浓度会决定地核剖面更偏层岩、晶体还是玻璃矿物。
    float coverDarkLuma = luminance(pigment);
    float coverBrightLuma = luminance(brightSwatch);
    float coverContrast = clamp((coverBrightLuma - coverDarkLuma) * 1.55, 0.0, 1.0);
    float coverChroma =
      max(max(brightSwatch.r, brightSwatch.g), brightSwatch.b)
      - min(min(brightSwatch.r, brightSwatch.g), brightSwatch.b);
    float crystalProfile = smoothstep(0.16, 0.58, coverChroma);
    float glassProfile =
      (1.0 - crystalProfile * 0.58)
      * smoothstep(0.48, 0.86, coverBrightLuma);
    float strataProfile = clamp(1.0 - max(crystalProfile, glassProfile) * 0.72, 0.0, 1.0);
    float brightPeak = max(max(brightSwatch.r, brightSwatch.g), brightSwatch.b);
    vec3 coverMineralHue = mix(
      pigmentHue,
      brightSwatch / max(0.16, brightPeak),
      0.38
    );
    coverMineralHue = mix(
      vec3(luminance(coverMineralHue)),
      coverMineralHue,
      0.66
    );

    // 低频噪声只负责扭曲大尺度地貌；真实岩石、裂隙和坑口来自独立材质。
    vec2 terrainUv = vec2(planetUv.x * 3.9, planetUv.y * 3.25);
    float warp = fbm(terrainUv + vec2(2.3, -1.7));
    float terrain = fbm(terrainUv + vec2(warp * 1.42, -warp * 1.08));
    float detail = fbm(terrainUv * 1.92 + vec2(-3.2, 4.7));
    float continent = smoothstep(0.38, 0.69, terrain);
    float highland = smoothstep(0.63, 0.88, detail + terrain * 0.18);
    float fissure = 1.0 - smoothstep(0.030, 0.084, abs(detail - 0.515));
    fissure *= smoothstep(0.24, 0.76, continent + highland);

    // 独立写实行星材质不带固定灯光，封面颜色只以低比例参与染色。
    vec2 rockUvUnwrapped = vec2(
      planetUv.x + (warp - 0.5) * 0.018,
      clamp(planetUv.y + (terrain - 0.5) * 0.010, 0.004, 0.996)
    );
    vec2 rockUv = vec2(fract(rockUvUnwrapped.x), rockUvUnwrapped.y);
    // 播放旋转时必须根据屏幕像素覆盖范围选择 mip。
    // 之前强制最高精度会让细坑逐帧跨像素，产生摩尔纹和闪烁噪点。
    vec2 colorDx = dFdx(rockUvUnwrapped) * 2.15;
    vec2 colorDy = dFdy(rockUvUnwrapped) * 2.15;
    vec3 rockAlbedo = textureGrad(uSurfaceTex, rockUv, colorDx, colorDy).rgb;
    // 在经度接缝附近改用纹理中部做柔和过渡，避免自转时出现一条竖向拼接线。
    float seamDistance = min(rockUv.x, 1.0 - rockUv.x);
    float seamBlend = smoothstep(0.0, 0.045, seamDistance);
    vec3 seamAlbedo = textureGrad(
      uSurfaceTex,
      vec2(fract(rockUv.x + 0.5), rockUv.y),
      colorDx,
      colorDy
    ).rgb;
    rockAlbedo = mix(seamAlbedo, rockAlbedo, seamBlend);
    // 凹凸使用更宽的采样足迹，只保留板块和大型坑缘，不再读取砂砾颗粒。
    vec2 heightDx = colorDx * 4.8;
    vec2 heightDy = colorDy * 4.8;
    vec3 heightAlbedo = textureGrad(uSurfaceTex, rockUv, heightDx, heightDy).rgb;
    vec3 seamHeightAlbedo = textureGrad(
      uSurfaceTex,
      vec2(fract(rockUv.x + 0.5), rockUv.y),
      heightDx,
      heightDy
    ).rgb;
    float rockHeight = luminance(mix(seamHeightAlbedo, heightAlbedo, seamBlend));
    float rockTone = smoothstep(0.12, 0.62, rockHeight);
    vec3 mineralTint = mix(vec3(0.76, 0.81, 0.88), pigmentHue, 0.24);
    vec3 surfaceColor = rockAlbedo * mineralTint * 1.34;
    surfaceColor = mix(surfaceColor, mix(deepColor, middleColor, rockTone), 0.22);
    surfaceColor = mix(surfaceColor, crystalColor, highland * 0.075);

    // 细颗粒不再参与凹凸，只让经过低频过滤的板块与大型坑缘轻微改变反光。
    // 播放旋转时不会因为一排小坑跨过像素而闪烁。
    float terrainHeight =
      terrain * 0.34
      + detail * 0.065
      + rockHeight * 0.035
      + highland * 0.020;
    vec2 terrainSlope = vec2(dFdx(terrainHeight), dFdy(terrainHeight));
    float reliefStrength = 1.45 * smoothstep(0.08, 0.66, sphereZ);
    vec3 reliefNormal = normalize(vec3(
      sphereNormal.xy - terrainSlope * reliefStrength,
      sphereNormal.z
    ));

    // 云带与岩层反向缓慢漂移，形成独立于地表的第二层运动。
    vec2 cloudUv = vec2(
      planetUv.x * 7.2 - uSpinAngle * 0.018 - uFrames * 0.00012,
      planetUv.y * 6.0
    );
    float cloudNoise = fbm(cloudUv + vec2(warp * 0.62, 0.0));
    float cloudBand = smoothstep(0.65, 0.83, cloudNoise + sin(planetUv.y * 22.0) * 0.045);

    // 左上方单一主光制造清晰的昼夜面；地形法线让亮部不是均匀铺色。
    vec3 lightDirection = normalize(vec3(-0.72, 0.36, 0.46));
    float hemisphereLight = dot(sphereNormal, lightDirection);
    float dayHemisphere = smoothstep(-0.14, 0.30, hemisphereLight);
    float terrainLight = clamp(
      dot(reliefNormal, lightDirection) + (terrain - 0.5) * 0.18,
      -1.0,
      1.0
    );
    float reliefDaylight = smoothstep(-0.16, 0.30, terrainLight);
    float daylight = dayHemisphere * (0.48 + reliefDaylight * 0.52);
    float diffuseLight = max(0.0, terrainLight);
    float highLight = smoothstep(0.44, 0.76, terrainLight);
    vec3 nightSurface = deepColor * 0.045 + magicGlow * fissure * 0.065;
    vec3 litSurface = surfaceColor * (0.48 + diffuseLight * 0.64);
    vec3 shellColor = mix(nightSurface, litSurface, daylight);
    shellColor = mix(shellColor, crystalColor, cloudBand * daylight * 0.065);
    shellColor += magicGlow * fissure * (0.10 + (1.0 - daylight) * 0.34);
    shellColor *= 0.82 + highLight * 0.18;

    // 云层和矿物只在迎光面出现小范围高光，帮助眼睛判断球面的朝向。
    vec3 shellHalfVector = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
    float shellNdotH = max(0.0, dot(reliefNormal, shellHalfVector));
    float broadSpecular = pow(shellNdotH, 9.0) * daylight;
    float mineralSpecular = pow(shellNdotH, 42.0);
    mineralSpecular *= daylight * (0.12 + cloudBand * 0.88);
    shellColor += mix(middleColor, vec3(0.74, 0.86, 1.0), 0.36)
      * broadSpecular
      * (0.055 + cloudBand * 0.045);
    shellColor += mix(crystalColor, vec3(0.82, 0.92, 1.0), 0.42)
      * mineralSpecular
      * 0.07;

    // 临近轮廓的位置自然压暗，形成从正面向侧面的连续转折。
    // 后面仍会叠加一层很薄的大气光，所以边缘不会变成生硬黑圈。
    float sphericalFalloff = smoothstep(0.035, 0.72, sphereZ);
    shellColor *= 0.34 + sphericalFalloff * 0.66;
    shellColor += magicGlow
      * pow(1.0 - sphereZ, 3.2)
      * (1.0 - dayHemisphere)
      * 0.14;

    // 洞口略微偏离圆心。两层不同频率的噪声一起切边：
    // 大块缺口负责“凿穿”的轮廓，小块崩边负责碎石感，避免看成规整花边。
    vec2 coreCenter = vec2(-0.050, 0.032);
    float coreRadius = 0.385;
    vec2 corePoint = (sphereXY - coreCenter) / coreRadius;
    float coreDistance = length(corePoint);
    float coreAngle = atan(corePoint.y, corePoint.x);
    vec2 edgeDirection = vec2(cos(coreAngle), sin(coreAngle));
    float chippedNoise = fbm(edgeDirection * 3.2 + vec2(2.7, -4.1));
    float chippedDetail = fbm(edgeDirection * 8.6 + vec2(-5.3, 1.9));
    float coreEdgeWarp =
      sin(coreAngle * 5.0 + 0.8) * 0.042
      + sin(coreAngle * 9.0 - 1.1) * 0.024
      + (chippedNoise - 0.5) * 0.150
      + (chippedDetail - 0.5) * 0.072;
    float coreLimit = 0.94 + coreEdgeWarp;
    float craterLimit =
      1.50
      + coreEdgeWarp * 0.58
      + sin(coreAngle * 13.0 + chippedNoise * 5.0) * 0.038
      + (chippedDetail - 0.5) * 0.050;
    float coreAa = aa / coreRadius;
    float coreMask = 1.0 - smoothstep(coreLimit - coreAa, coreLimit + coreAa, coreDistance);
    float craterMask = 1.0 - smoothstep(craterLimit - coreAa, craterLimit + coreAa, coreDistance);
    float craterRim = max(0.0, craterMask - coreMask);

    // 从破口向外长出少量主裂缝。每条裂缝都有不同长度和弯折，
    // 并在中段分叉；它们压暗地表而不是发金光，所以读起来是断裂而非装饰。
    float surfaceOffset = max(0.0, coreDistance - craterLimit);
    float surfaceCrack = 0.0;
    float surfaceCrackLip = 0.0;
    for (int crackIndex = 0; crackIndex < 8; crackIndex++) {
      float crackId = float(crackIndex);
      float crackSeed = hash21(vec2(crackId * 4.73 + float(itemIndex), 9.17));
      float reachSeed = hash21(vec2(crackId * 8.11, float(itemIndex) * 2.37 + 3.8));
      float rootAngle = crackSeed * PI * 2.0 - PI;
      float crackReach = mix(0.34, 1.02, reachSeed);
      float pathNoise = fbm(vec2(
        surfaceOffset * 4.4 + crackSeed * 7.0,
        crackSeed * 11.0 - surfaceOffset * 1.7
      ));
      float pathAngle =
        rootAngle
        + sin(surfaceOffset * 8.2 + crackSeed * 15.0) * 0.036
        + (pathNoise - 0.5) * 0.13;
      float angleDistance = abs(atan(
        sin(coreAngle - pathAngle),
        cos(coreAngle - pathAngle)
      ));
      float crackWidth = mix(0.023, 0.006, clamp(surfaceOffset / crackReach, 0.0, 1.0));
      float crackBody = 1.0 - smoothstep(crackWidth, crackWidth * 2.05, angleDistance);
      float crackLength =
        smoothstep(-0.008, 0.035, surfaceOffset)
        * (1.0 - smoothstep(crackReach * 0.72, crackReach, surfaceOffset));

      float branchStart = mix(0.16, 0.34, crackSeed);
      float branchDirection = crackIndex % 2 == 0 ? 1.0 : -1.0;
      float branchAngle =
        pathAngle
        + branchDirection
          * smoothstep(branchStart, branchStart + 0.20, surfaceOffset)
          * 0.34;
      float branchDistance = abs(atan(
        sin(coreAngle - branchAngle),
        cos(coreAngle - branchAngle)
      ));
      float branchBody =
        1.0 - smoothstep(crackWidth * 0.46, crackWidth * 1.12, branchDistance);
      float branchLength =
        smoothstep(branchStart, branchStart + 0.055, surfaceOffset)
        * (1.0 - smoothstep(crackReach * 0.48, crackReach * 0.70, surfaceOffset));

      float currentCrack = max(
        crackBody * crackLength,
        branchBody * branchLength * 0.78
      );
      surfaceCrack = max(surfaceCrack, currentCrack);

      float lipDistance = abs(atan(
        sin(coreAngle - pathAngle - crackWidth * 2.10),
        cos(coreAngle - pathAngle - crackWidth * 2.10)
      ));
      float currentLip =
        (1.0 - smoothstep(crackWidth * 0.40, crackWidth * 0.90, lipDistance))
        * crackLength;
      surfaceCrackLip = max(surfaceCrackLip, currentLip);
    }
    float outsideCrater = 1.0 - craterMask;
    surfaceCrack *= outsideCrater;
    surfaceCrackLip *= outsideCrater * (1.0 - surfaceCrack);
    float brokenRimLip =
      (1.0 - smoothstep(0.0, 0.095, abs(coreDistance - craterLimit)))
      * outsideCrater;
    shellColor = mix(shellColor, deepColor * 0.04, surfaceCrack * 0.86);
    shellColor *= 1.0 - brokenRimLip * (0.38 + chippedDetail * 0.20);
    shellColor += mix(middleColor, vec3(0.54, 0.57, 0.62), 0.34)
      * surfaceCrackLip
      * daylight
      * 0.12;

    // NASA / USGS 的地球剖面不是一个发红的空洞，而是“地幔 → 液态外核 → 固态内核”。
    // 热运动独立于播放状态：即使暂停，液态外核仍保持很慢的对流。
    // 时间只推动噪声场平移，不再驱动一段几秒重复一次的正弦动画。
    float heatTime = uFrames * 0.0032;
    vec2 heatFlow = vec2(
      valueNoise(corePoint * 6.2 + vec2(heatTime, -heatTime * 0.7)),
      valueNoise(corePoint.yx * 5.7 + vec2(-heatTime * 0.8, heatTime))
    ) - 0.5;

    vec3 coreHalfVector = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
    float innerCoreLimit =
      0.64
      + sin(coreAngle * 7.0 - 0.4) * 0.008
      + (chippedNoise - 0.5) * 0.018;

    // 液态外核：铁镍流体是连续、厚重的金橙色层，不是一圈均匀霓虹红光。
    float liquidFlowA = fbm(
      corePoint * vec2(4.2, 6.8)
        + vec2(heatTime * 0.44, -heatTime * 0.62)
    );
    float liquidFlowB = fbm(
      corePoint.yx * vec2(6.1, 3.7)
        + vec2(-heatTime * 0.21, heatTime * 0.33)
        + vec2(4.8, -2.6)
    );
    float liquidFlow = mix(liquidFlowA, liquidFlowB, 0.34);
    float liquidBands = smoothstep(
      0.34,
      0.76,
      liquidFlowA * 0.64 + liquidFlowB * 0.36
    );
    float liquidVein =
      1.0 - smoothstep(0.025, 0.095, abs(liquidFlow - 0.52));
    float strataBands =
      0.5 + 0.5 * sin(
        coreDistance * mix(24.0, 38.0, strataProfile)
        + coreAngle * mix(1.4, 3.2, coverContrast)
        + liquidFlow * 4.2
      );
    float facetField = fbm(
      corePoint * mix(3.2, 5.4, crystalProfile)
        + vec2(liquidFlowB * 0.44, -liquidFlowA * 0.36)
    );
    float crystalFacet = smoothstep(0.48, 0.72, facetField);

    // 气体从岩浆内部向镜头方向顶起：气泡中心不在画面里漂移，
    // 而是在原地鼓起、膨胀、变薄，最后裂成扩散的断续环。
    float bubbleInterior = 0.0;
    float bubbleRim = 0.0;
    float bubbleHighlight = 0.0;
    float bubblePopRing = 0.0;
    for (int bubbleIndex = 0; bubbleIndex < 4; bubbleIndex++) {
      float bubbleId = float(bubbleIndex);
      float seed = hash21(vec2(bubbleId * 7.31 + float(itemIndex) * 1.73, 4.27));
      float speed = mix(0.52, 0.78, seed);
      float bubbleClock = heatTime * speed + seed * 1.91;
      float life = fract(bubbleClock);
      float generation = floor(bubbleClock);
      float positionSeed = hash21(vec2(
        bubbleId * 5.17 + generation * 2.31,
        float(itemIndex) * 1.47 + 8.2
      ));
      float bubbleAngle =
        positionSeed * PI * 2.0
        + bubbleId * 2.39996;
      float bubbleTrackRadius = mix(
        0.76,
        0.84,
        hash21(vec2(positionSeed, generation + 3.8))
      );
      vec2 bubbleCenter =
        vec2(cos(bubbleAngle), sin(bubbleAngle))
        * bubbleTrackRadius;
      float swell = smoothstep(0.04, 0.62, life);
      float bubbleRadius = mix(0.026, 0.094, swell);
      float bodyVisibility =
        smoothstep(0.02, 0.10, life)
        * (1.0 - smoothstep(0.63, 0.74, life));
      float popVisibility =
        smoothstep(0.64, 0.72, life)
        * (1.0 - smoothstep(0.90, 0.98, life));
      vec2 bubbleScale = vec2(
        bubbleRadius * mix(1.0, 1.30, popVisibility),
        bubbleRadius * mix(1.0, 0.78, popVisibility)
      );
      vec2 bubbleDelta = (corePoint - bubbleCenter) / bubbleScale;
      float bubbleDistance = length(bubbleDelta);
      float currentInterior =
        (1.0 - smoothstep(0.70, 0.98, bubbleDistance))
        * bodyVisibility;
      float currentRim =
        smoothstep(0.72, 0.91, bubbleDistance)
        * (1.0 - smoothstep(0.98, 1.09, bubbleDistance))
        * bodyVisibility;
      float currentHighlight =
        1.0 - smoothstep(
          0.12,
          0.34,
          length(bubbleDelta - vec2(-0.32, 0.36))
        );
      currentHighlight *= bodyVisibility;

      float popDistance = length(
        (corePoint - bubbleCenter)
        / (bubbleRadius * mix(1.18, 1.82, popVisibility))
      );
      float popAngle = atan(
        corePoint.y - bubbleCenter.y,
        corePoint.x - bubbleCenter.x
      );
      float brokenArc =
        smoothstep(-0.30, 0.36, sin(popAngle * 3.0 + seed * 11.0));
      float currentPopRing =
        smoothstep(0.76, 0.91, popDistance)
        * (1.0 - smoothstep(0.96, 1.08, popDistance))
        * popVisibility
        * (0.24 + brokenArc * 0.76);

      bubbleInterior = max(bubbleInterior, currentInterior);
      bubbleRim = max(bubbleRim, currentRim);
      bubbleHighlight = max(bubbleHighlight, currentHighlight);
      bubblePopRing = max(bubblePopRing, currentPopRing);
    }
    float magmaBubbleRegion =
      smoothstep(innerCoreLimit + 0.035, innerCoreLimit + 0.10, coreDistance)
      * (1.0 - smoothstep(coreLimit - 0.12, coreLimit - 0.025, coreDistance));
    bubbleInterior *= magmaBubbleRegion;
    bubbleRim *= magmaBubbleRegion;
    bubbleHighlight *= magmaBubbleRegion;
    bubblePopRing *= magmaBubbleRegion;

    float coreMaterialHeight =
      liquidFlow * (0.52 + glassProfile * 0.18)
      + strataBands * strataProfile * 0.16
      + crystalFacet * crystalProfile * 0.22
      + bubbleInterior * 0.075;
    vec2 coreMaterialSlope = vec2(
      dFdx(coreMaterialHeight),
      dFdy(coreMaterialHeight)
    );
    // 地核是接近正面的地质断面，不强行拱成环面。
    // 立体信息只来自缓慢移动的粗糙高度与层级交界阴影。
    vec3 coreMaterialNormal = normalize(vec3(
      -coreMaterialSlope * mix(1.45, 2.65, coverContrast),
      1.0
    ));
    float coreDiffuse = max(0.0, dot(coreMaterialNormal, lightDirection));

    // 仍保留真实地核的热金属基底，但让封面参与矿物反射，而不是把整圈直接染色。
    vec3 outerCoreDeep = mix(
      vec3(0.018, 0.008, 0.006),
      coverMineralHue * 0.045,
      0.24
    );
    vec3 outerCoreIron = mix(
      vec3(0.24, 0.062, 0.018),
      coverMineralHue * 0.28 + vec3(0.034, 0.012, 0.006),
      0.24 + crystalProfile * 0.06
    );
    vec3 outerCoreHot = mix(
      vec3(0.58, 0.19, 0.038),
      coverMineralHue * 0.46 + vec3(0.08, 0.036, 0.012),
      0.14 + glassProfile * 0.05
    );
    vec3 outerCoreColor = mix(
      outerCoreDeep,
      outerCoreIron,
      0.20 + liquidFlow * 0.42
    );
    outerCoreColor = mix(
      outerCoreColor,
      outerCoreHot,
      liquidBands * (0.055 + glassProfile * 0.035)
        + liquidVein * 0.025
        + crystalFacet * crystalProfile * 0.035
        + strataBands * strataProfile * 0.025
    );
    outerCoreColor *=
      (0.32 + coreDiffuse * 0.46)
      * (1.0 + uAudioBass * 0.020);
    outerCoreColor *= 1.0 - bubbleInterior * 0.11;
    outerCoreColor += outerCoreHot
      * (bubbleRim * 0.16 + bubbleHighlight * 0.22 + bubblePopRing * 0.18);
    outerCoreColor += outerCoreHot * liquidVein * uAudioMid * 0.025;
    float outerCoreHighlight = pow(
      max(0.0, dot(coreMaterialNormal, coreHalfVector)),
      mix(8.0, 18.0, clamp(glassProfile + crystalProfile * 0.52, 0.0, 1.0))
    );
    outerCoreColor += outerCoreHot
      * outerCoreHighlight
      * mix(0.045, 0.12, max(glassProfile, crystalProfile));
    float innerCoreContact =
      1.0 - smoothstep(0.0, 0.075, abs(coreDistance - innerCoreLimit));
    float outerCoreContact =
      1.0 - smoothstep(0.0, 0.060, abs(coreDistance - coreLimit));
    outerCoreColor *= 1.0 - innerCoreContact * 0.26 - outerCoreContact * 0.18;

    // 封面位于深坑底部：保持接近平面，只在边缘加遮蔽，
    // 避免它再鼓成一颗球，看起来像真正嵌在竖井底端。
    float innerCoreMask =
      1.0 - smoothstep(
        innerCoreLimit - coreAa * 1.4,
        innerCoreLimit + coreAa * 1.4,
        coreDistance
      );
    vec2 innerCorePoint = corePoint / max(0.001, innerCoreLimit);
    float innerCoreDistance = length(innerCorePoint);
    float innerCoreZ = sqrt(max(0.0, 1.0 - dot(innerCorePoint, innerCorePoint)));
    vec3 innerCoreNormal = normalize(vec3(innerCorePoint * 0.08, 1.0));
    vec2 flatCoreUv = innerCorePoint * 0.455 + 0.5;
    vec2 roundedCoreUv = vec2(
      0.5 + atan(innerCoreNormal.x, max(0.0001, innerCoreNormal.z)) / PI,
      0.5 + asin(clamp(innerCoreNormal.y, -1.0, 1.0)) / PI
    );
    float coreCurve = smoothstep(0.20, 0.98, innerCoreDistance) * 0.035;
    vec2 coreUv = clamp(
      mix(flatCoreUv, roundedCoreUv, coreCurve)
        + heatFlow * 0.004 * smoothstep(0.72, 1.0, innerCoreDistance),
      vec2(0.008),
      vec2(0.992)
    );
    coreUv.y = 1.0 - coreUv.y;
    vec2 atlasCoreUv = coreUv * cellSize + cellOffset;
    vec3 coreCover = texture(uTex, atlasCoreUv).rgb;
    vec3 innerCoreColor = pow(max(coreCover, vec3(0.0)), vec3(0.96));
    float innerCoreDiffuse = max(0.0, dot(innerCoreNormal, lightDirection));
    float innerCoreCurvature = smoothstep(0.04, 0.78, innerCoreZ);
    innerCoreColor *= 0.70 + innerCoreDiffuse * 0.34;
    innerCoreColor *= 0.93 + innerCoreCurvature * 0.07;
    innerCoreColor *= 1.0 - smoothstep(0.70, 1.0, innerCoreDistance) * 0.30;
    float innerCoreHighlight =
      pow(max(0.0, dot(innerCoreNormal, coreHalfVector)), 30.0);
    innerCoreColor += vec3(1.0) * innerCoreHighlight * 0.14;
    float coverGlassEdge = pow(smoothstep(0.48, 1.0, innerCoreDistance), 2.2);
    innerCoreColor += coverMineralHue
      * coverGlassEdge
      * (0.025 + glassProfile * 0.045);

    float innerBoundary =
      smoothstep(innerCoreLimit - 0.045, innerCoreLimit, coreDistance)
      * (1.0 - smoothstep(innerCoreLimit, innerCoreLimit + 0.055, coreDistance));
    outerCoreColor += outerCoreHot * innerBoundary * 0.34;
    vec3 coreColor = mix(outerCoreColor, innerCoreColor, innerCoreMask);

    // 暗腔、破碎坑壁与岩层台阶共同制造“被挖掘出来”的纵深。
    vec2 rimDirection = corePoint / max(0.001, coreDistance);
    float rimLight = dot(rimDirection, normalize(vec2(-0.58, 0.82))) * 0.5 + 0.5;
    float wallDepth = clamp(
      (coreDistance - coreLimit) / max(0.001, craterLimit - coreLimit),
      0.0,
      1.0
    );
    float terracePattern =
      0.5 + 0.5 * sin(
        coreDistance * mix(18.0, 26.0, strataProfile)
        + chippedNoise * 10.0
        + chippedDetail * 5.0
        + coreAngle * mix(2.4, 4.0, coverContrast)
      );
    float terraceLight = smoothstep(0.58, 0.92, terracePattern) * craterRim;
    float mantleFlow = fbm(
      corePoint * vec2(3.1, 4.5)
        + vec2(-heatTime * 0.22, heatTime * 0.15)
    );
    float mantleFold =
      0.5 + 0.5 * sin(
        coreDistance * 34.0
        + coreAngle * 2.2
        + mantleFlow * 5.0
      );
    // 外圈仍然是地质切面，只给断口很小的朝内倾角。
    // 主要厚度来自层理凹凸和交界处的遮蔽，不做光滑漏斗。
    vec3 craterWallNormal = normalize(vec3(
      -rimDirection * mix(0.22, 0.055, wallDepth),
      1.0
    ));
    float craterMaterialHeight =
      mantleFlow * 0.48
      + mantleFold * 0.18
      + terracePattern * strataProfile * 0.14;
    vec2 craterMaterialSlope = vec2(
      dFdx(craterMaterialHeight),
      dFdy(craterMaterialHeight)
    );
    vec3 craterMaterialNormal = normalize(vec3(
      craterWallNormal.xy - craterMaterialSlope * mix(1.8, 2.8, coverContrast),
      craterWallNormal.z
    ));
    float craterDiffuse = max(0.0, dot(craterMaterialNormal, lightDirection));
    float craterSpecular = pow(
      max(0.0, dot(craterMaterialNormal, coreHalfVector)),
      mix(8.0, 18.0, max(glassProfile, crystalProfile))
    );
    vec3 mantleDeep = mix(
      vec3(0.038, 0.014, 0.012),
      coverMineralHue * 0.055,
      0.30
    );
    vec3 mantleRock = mix(
      vec3(0.27, 0.062, 0.018),
      coverMineralHue * 0.30,
      0.26 + crystalProfile * 0.08
    );
    vec3 mantleWarm = mix(
      vec3(0.62, 0.14, 0.022),
      coverMineralHue * 0.58 + vec3(0.08, 0.025, 0.006),
      0.20
    );
    vec3 craterColor = mix(
      mantleDeep,
      mantleRock,
      0.30 + mantleFlow * 0.54
    );
    craterColor = mix(craterColor, mantleWarm, mantleFold * 0.16);
    float craterDepthOcclusion = mix(
      0.24,
      0.94,
      smoothstep(0.02, 0.78, wallDepth)
    );
    craterColor *=
      (0.34 + craterDiffuse * 0.58 + rimLight * 0.08)
      * craterDepthOcclusion;
    craterColor += mantleWarm * terraceLight * 0.12;
    craterColor += outerCoreHot
      * craterSpecular
      * mix(0.025, 0.07, max(glassProfile, crystalProfile));
    float craterInnerContact =
      1.0 - smoothstep(0.0, 0.10, abs(coreDistance - coreLimit));
    craterColor *= 1.0 - craterInnerContact * 0.32;
    float terraceCavity =
      1.0 - smoothstep(0.04, 0.16, abs(terracePattern - 0.50));
    craterColor *= 1.0 - terraceCavity * strataProfile * 0.09;

    // 靠近表面的最后一圈重新压暗为薄地壳，避免整个剖面都像熔岩。
    float crustBand = smoothstep(0.78, 1.0, wallDepth);
    vec3 crustColor = mix(deepColor * 0.34, middleColor * 0.20, chippedNoise);
    craterColor = mix(craterColor, crustColor, crustBand * 0.84);

    // 坑壁裂缝保持深色，只在极少数深处带一点余温。
    // 重点是“断裂的岩壁”，不能再形成一圈发光花纹。
    vec3 heatDeep = mix(vec3(0.18, 0.016, 0.006), coverMineralHue * 0.08, 0.18);
    vec3 heatMid = mix(vec3(0.90, 0.21, 0.026), coverMineralHue * 0.72, 0.14);
    vec3 heatHot = mix(vec3(1.00, 0.64, 0.16), coverMineralHue * 0.88, 0.10);
    float thermalNoise = fbm(corePoint * 4.8 + vec2(heatTime * 0.8, -heatTime * 0.55));
    float moltenCrack = 1.0 - smoothstep(0.018, 0.058, abs(thermalNoise - 0.515));
    moltenCrack *= craterRim * smoothstep(0.08, 0.72, wallDepth) * (1.0 - crustBand * 0.72);
    float innerHeatLip =
      craterRim
      * (1.0 - smoothstep(coreLimit + 0.025, coreLimit + 0.11, coreDistance));
    innerHeatLip *= 0.28 + smoothstep(0.34, 0.68, thermalNoise) * 0.72;
    float heatPulse =
      0.92 + 0.08 * sin(coreAngle * 2.0 + thermalNoise * 5.0);
    craterColor = mix(craterColor, heatDeep, innerHeatLip * 0.18);
    craterColor *= 1.0 - moltenCrack * 0.52;
    craterColor += mantleWarm * moltenCrack * heatPulse * 0.035;

    // 外核与地幔交界有温差，但只保留窄而柔和的反照。
    float coreHeatEdge = smoothstep(0.64, 1.0, coreDistance) * coreMask;
    coreColor += heatMid * coreHeatEdge * heatPulse * 0.018;
    coreColor += heatHot * coreHeatEdge * uAudioTreble * 0.008;

    // 地表只保留极弱的深层反照，不能围成发光圆环。
    float heatHalo =
      (1.0 - smoothstep(craterLimit + 0.02, craterLimit + 0.52, coreDistance))
      * (1.0 - craterMask);
    float heatFocus = 0.30 + max(isActive, max(previousVisibility, isDragPreview * uDragging)) * 0.70;
    shellColor += mix(heatDeep, heatMid, 0.32) * heatHalo * heatPulse * heatFocus * 0.032;

    vec3 color = mix(shellColor, craterColor, craterRim);
    color = mix(color, coreColor, coreMask);

    float limb = pow(1.0 - sphereZ, 2.1);
    float wrappedLight = smoothstep(-0.36, 0.78, terrainLight);

    // 整颗星球共享一个大尺度球面阴影，坑壁与星核因此属于同一个球体，
    // 不会像几张独立圆形贴图叠在一起。
    float globeShadow = 0.52 + dayHemisphere * 0.48;
    color *= mix(globeShadow, 0.82 + dayHemisphere * 0.18, coreMask * 0.36);

    // 薄大气层只沿轮廓出现；迎光侧更亮，背光侧只保留冷色细边。
    float atmosphere = limb * smoothstep(0.68, 0.99, r);
    color += mix(vec3(0.12, 0.09, 0.38), magicGlow, wrappedLight)
      * atmosphere
      * (0.26 + dayHemisphere * 0.52);
    float surroundingDepth = smoothstep(0.16, 0.58, uSurroundingVisibility);
    color += magicGlow
      * limb
      * surroundingDepth
      * (1.0 - max(isActive, isPrevious))
      * 0.24;

    // 星环投在球面上的斜向暗影，让环确实像穿过星球，而不是悬浮贴纸
    vec2 ringSpace = mat2(0.982, -0.191, 0.191, 0.982) * pRaw;
    float ringShadow = 1.0 - smoothstep(0.012, 0.034, abs(ringSpace.y + 0.038));
    float ringShadowMask = smoothstep(0.22, 0.86, r) * (1.0 - smoothstep(0.92, 1.0, r));
    color *= 1.0 - ringShadow * ringShadowMask * 0.16;

    // 远处星球降低饱和度和亮度，像藏在宇宙褶皱后的天体，不抢中央焦点
    float transitionFocus = max(
      max(isActive, isPrevious * previousFade),
      isDragPreview * uDragging * 0.78
    );
    float grayscale = luminance(color);
    color = mix(vec3(grayscale) * vec3(0.48, 0.62, 0.82), color, 0.28 + transitionFocus * 0.72);
    color *= 0.42 + transitionFocus * 0.58;

    float edgeAlpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    float focusedDepth = max(
      vAlpha,
      max(0.66 * previousFade, max(isActive, isDragPreview) * uDragging * 0.82)
    );
    // 拖动时保留近邻星球的轮廓，避免景深计算把它们压到完全不可见。
    float ambientDepth = mix(pow(vAlpha, 2.8), max(vAlpha, 0.46), surroundingDepth);
    float depthAlpha = mix(ambientDepth, focusedDepth, transitionFocus);
    outColor = vec4(color, 1.0);
    outColor.a *= edgeAlpha * depthAlpha * instanceVisibility;
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
  // 主画布上限从 2x 收到 1.5x；肉眼清晰度变化很小，但高分屏片元量可少约 44%。
  const dpr = Math.min(1.5, window.devicePixelRatio);
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
  hasDragged = false;
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
    this.dragStartPos = vec2.create();
    this._rotationVelocity = 0;
    this._combinedQuat = quat.create();
    this.eventController = new AbortController();
    const eventOptions = { signal: this.eventController.signal };

    canvas.addEventListener('pointerdown', e => {
      // 只有中央圆形专辑图区域可以拖动，其他区域不响应
      if (!this.#isInsideDragArea(e)) return;
      canvas.setPointerCapture?.(e.pointerId);
      vec2.set(this.pointerPos, e.clientX, e.clientY);
      vec2.copy(this.previousPointerPos, this.pointerPos);
      vec2.copy(this.dragStartPos, this.pointerPos);
      this.isPointerDown = true;
      this.hasDragged = false;
      canvas.style.cursor = 'grabbing';
    }, eventOptions);
    canvas.addEventListener('pointerup', e => {
      this.isPointerDown = false;
      if (canvas.hasPointerCapture?.(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      canvas.style.cursor = 'default';
    }, eventOptions);
    canvas.addEventListener('pointercancel', () => {
      this.isPointerDown = false;
      canvas.style.cursor = 'default';
    }, eventOptions);
    canvas.addEventListener('pointerleave', () => {
      // pointer capture 会继续把界外移动送回画布；拖动中不能在这里提前结束。
      if (!this.isPointerDown) canvas.style.cursor = 'default';
    }, eventOptions);
    canvas.addEventListener('pointermove', e => {
      if (this.isPointerDown) {
        vec2.set(this.pointerPos, e.clientX, e.clientY);
      } else {
        canvas.style.cursor = this.#isInsideDragArea(e) ? 'grab' : 'default';
      }
    }, eventOptions);

    canvas.style.touchAction = 'none';
  }

  /** 手势等外部指针：按下（clientX/clientY 坐标系） */
  externalDown(x, y) {
    vec2.set(this.pointerPos, x, y);
    vec2.copy(this.previousPointerPos, this.pointerPos);
    vec2.copy(this.dragStartPos, this.pointerPos);
    this.isPointerDown = true;
    this.hasDragged = false;
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

  destroy() {
    this.eventController.abort();
    this.isPointerDown = false;
    this.canvas.style.cursor = 'default';
  }

  /** 结束上一段旋转惯性，避免切歌落位后又被旧速度带动一帧。 */
  stopInertia() {
    quat.identity(this.pointerRotation);
    quat.identity(this._combinedQuat);
    this._rotationVelocity = 0;
    this.rotationVelocity = 0;
  }

  get dragOffsetX() {
    return this.pointerPos[0] - this.dragStartPos[0];
  }

  get dragOffsetY() {
    return this.pointerPos[1] - this.dragStartPos[1];
  }

  get dragActivationDistance() {
    const shortSide = Math.min(this.canvas.clientWidth, this.canvas.clientHeight);
    return Math.max(48, Math.min(72, shortSide * 0.06));
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
      const dragDistance = Math.hypot(this.dragOffsetX, this.dragOffsetY);

      // 长按和手指轻微抖动不算拖动。真正越过门槛时，只丢弃门槛以内的距离，
      // 超出的部分仍参与旋转，因此快速滑动也不会失效。
      if (!this.hasDragged) {
        if (dragDistance >= this.dragActivationDistance) {
          this.hasDragged = true;
          const overflowRatio =
            (dragDistance - this.dragActivationDistance) / Math.max(1, dragDistance);
          vec2.set(
            this.previousPointerPos,
            this.pointerPos[0] - this.dragOffsetX * overflowRatio,
            this.pointerPos[1] - this.dragOffsetY * overflowRatio
          );
        } else {
          vec2.copy(this.previousPointerPos, this.pointerPos);
          quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, INTENSITY);
        }
      }

      if (this.hasDragged) {
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
      }
    } else {
      const INTENSITY = 0.1 * timeScale;
      quat.slerp(this.pointerRotation, this.pointerRotation, this.IDENTITY_QUAT, INTENSITY);

      if (this.snapTargetDirection) {
        // 放慢星系吸附，让旧星球离场、新星球入场的空间过程能被看见
        const SNAPPING_INTENSITY = 0.18;
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
  SWITCH_REVEAL_DURATION = 820;

  #time = 0;
  #deltaTime = 0;
  #deltaFrames = 0;
  #frames = 0;
  animationFrameId = 0;
  destroyed = false;

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
  interactionPhase = 'idle';
  reportedItemIndex = -1;
  surroundingVisibility = 0;
  activeDiscIndex = -1;
  previousDiscIndex = -1;
  spinAngle = 0;
  spinning = false;
  audioBass = 0;
  audioMid = 0;
  audioTreble = 0;
  switchRevealTime = 0;
  wasPointerDown = false;
  dragOriginDiscIndex = -1;
  dragPreviewDiscIndex = -1;
  dragSettleActive = false;
  dragSettleElapsed = 0;
  dragSettleDuration = 260;
  dragSettleProgress = 0;
  dragSettleShouldCommit = false;
  dragCommitDistance = 0.24;
  dragSettleStartOffset = vec2.create();
  dragSettleTargetOffset = vec2.create();
  dragSettleOffset = vec2.create();
  dragSettleTargetDiscIndex = -1;
  grabProgress = 0;
  dragSettleStartGrabProgress = 0;
  dragSettleStartCameraZ = 3;
  dragOriginOrientation = quat.create();
  dragSettleStartOrientation = quat.create();
  dragSettleTargetOrientation = quat.create();
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

  get isDragTransitioning() {
    return (
      this.interactionPhase === 'holding'
      || this.interactionPhase === 'dragging'
      || this.interactionPhase === 'settling'
    );
  }

  #setInteractionPhase(nextPhase) {
    if (this.interactionPhase === nextPhase) return;
    this.interactionPhase = nextPhase;

    // 背景只在整段交互的头尾切换一次，不再被残余旋转速度反复启动。
    const isMoving = nextPhase !== 'idle';
    if (isMoving !== this.movementActive) {
      this.movementActive = isMoving;
      this.onMovementChange(isMoving);
    }
  }

  #reportActiveVertex(vertexIndex) {
    if (vertexIndex < 0 || this.items.length === 0) return;
    const itemIndex = vertexIndex % this.items.length;
    if (itemIndex === this.reportedItemIndex) return;
    this.reportedItemIndex = itemIndex;
    this.onActiveItemChange(itemIndex);
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
    if (this.destroyed) return;
    this.#deltaTime = Math.min(32, time - this.#time);
    this.#time = time;
    this.#deltaFrames = this.#deltaTime / this.TARGET_FRAME_DURATION;
    this.#frames += this.#deltaFrames;

    this.#animate(this.#deltaTime);
    this.#render();

    this.animationFrameId = requestAnimationFrame(t => this.run(t));
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrameId);
    this.control?.destroy();
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
      uSurfaceTex: gl.getUniformLocation(this.discProgram, 'uSurfaceTex'),
      uFrames: gl.getUniformLocation(this.discProgram, 'uFrames'),
      uItemCount: gl.getUniformLocation(this.discProgram, 'uItemCount'),
      uAtlasSize: gl.getUniformLocation(this.discProgram, 'uAtlasSize'),
      uActiveDisc: gl.getUniformLocation(this.discProgram, 'uActiveDisc'),
      uPreviousDisc: gl.getUniformLocation(this.discProgram, 'uPreviousDisc'),
      uDragPreviewDisc: gl.getUniformLocation(this.discProgram, 'uDragPreviewDisc'),
      uSpinAngle: gl.getUniformLocation(this.discProgram, 'uSpinAngle'),
      uSurroundingVisibility: gl.getUniformLocation(this.discProgram, 'uSurroundingVisibility'),
      uSwitchProgress: gl.getUniformLocation(this.discProgram, 'uSwitchProgress'),
      uAutoSwitching: gl.getUniformLocation(this.discProgram, 'uAutoSwitching'),
      uDragging: gl.getUniformLocation(this.discProgram, 'uDragging'),
      uAudioBass: gl.getUniformLocation(this.discProgram, 'uAudioBass'),
      uAudioMid: gl.getUniformLocation(this.discProgram, 'uAudioMid'),
      uAudioTreble: gl.getUniformLocation(this.discProgram, 'uAudioTreble'),
      uDragCommitProgress: gl.getUniformLocation(this.discProgram, 'uDragCommitProgress'),
      uDragOffset: gl.getUniformLocation(this.discProgram, 'uDragOffset'),
      uFocusNdcScale: gl.getUniformLocation(this.discProgram, 'uFocusNdcScale'),
      uGrabProgress: gl.getUniformLocation(this.discProgram, 'uGrabProgress')
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
    this.#initSurfaceTexture();

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

  #initSurfaceTexture() {
    const gl = this.gl;
    this.surfaceTex = createAndSetupTexture(
      gl,
      gl.LINEAR_MIPMAP_LINEAR,
      gl.LINEAR,
      gl.REPEAT,
      gl.CLAMP_TO_EDGE
    );
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anisotropy) {
      const maxAnisotropy = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(
        gl.TEXTURE_2D,
        anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(4, maxAnisotropy)
      );
    }

    // 图片完成前先放一个中性像素，避免首帧纹理不完整导致球体闪黑。
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([92, 100, 112, 255])
    );
    gl.generateMipmap(gl.TEXTURE_2D);

    const image = new Image();
    image.onload = () => {
      if (this.destroyed) return;
      gl.bindTexture(gl.TEXTURE_2D, this.surfaceTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
    image.onerror = () => {
      console.error('Failed to load realistic planet surface texture.');
    };
    image.src = '/textures/planet-surface-realistic-v2.png';
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

    // 拖动或自动切歌时短暂露出远景星球，静止后再沉回宇宙褶皱
    this.switchRevealTime = Math.max(0, this.switchRevealTime - deltaTime);
    const isDragTransitioning = this.isDragTransitioning;
    const isAutoSwitching =
      !isDragTransitioning && (this.#manualSnapVertex >= 0 || this.switchRevealTime > 0);
    // 拖动时只保留极淡的空间层，明确的下一首提示由边缘预览星球承担。
    const surroundingTarget = isDragTransitioning ? 0.08 : isAutoSwitching ? 0.18 : 0;
    const visibilityDuration = surroundingTarget > this.surroundingVisibility ? 150 : 460;
    const visibilityBlend = 1 - Math.exp(-deltaTime / visibilityDuration);
    this.surroundingVisibility += (surroundingTarget - this.surroundingVisibility) * visibilityBlend;
    if (this.switchRevealTime === 0 && this.surroundingVisibility < 0.003) {
      this.previousDiscIndex = -1;
    }

    // 播放时只向前累计相位，不能在固定时长后归零。
    // 归零会让纹理瞬间跳回旧位置，看起来像整段动画重新播放。
    if (this.spinning) {
      this.spinAngle += (deltaTime / 1000) * 0.4;
    }

    let positions = this.instancePositions.map(p => vec3.transformQuat(vec3.create(), p, this.control.orientation));
    const scale = 0.225;
    const SCALE_INTENSITY = 0.6;
    positions.forEach((p, ndx) => {
      const s = (Math.abs(p[2]) / this.SPHERE_RADIUS) * SCALE_INTENSITY + (1 - SCALE_INTENSITY);
      const isActivePlanet = ndx === this.activeDiscIndex;
      const isPreviousPlanet = ndx === this.previousDiscIndex && this.switchRevealTime > 0;
      // 主星球保持视觉焦点；远景星球缩小，形成进入/离开空间层的纵深关系
      // 自动切换的旧星球保持原尺寸，退场缩放统一交给着色器，避免点击首帧骤缩。
      const planetScale = isActivePlanet || isPreviousPlanet ? scale : scale * 0.66;
      // 自动切换的焦点星球屏幕尺寸由着色器统一控制，不再叠加球面深度缩放。
      const depthScale = isAutoSwitching && (isActivePlanet || isPreviousPlanet) ? 1 : s;
      const finalScale = depthScale * planetScale;
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
    // 与正常吸附完成后的主星球尺寸保持一致，避免退出过渡状态时突然放大。
    const focusRadiusNdcY = 0.41;
    gl.uniform2f(
      this.discLocations.uFocusNdcScale,
      focusRadiusNdcY / Math.max(0.001, this.camera.aspect),
      focusRadiusNdcY
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
    gl.uniform1i(this.discLocations.uPreviousDisc, this.previousDiscIndex);
    gl.uniform1i(this.discLocations.uDragPreviewDisc, this.dragPreviewDiscIndex);
    gl.uniform1f(this.discLocations.uSpinAngle, this.spinAngle);
    gl.uniform1f(this.discLocations.uSurroundingVisibility, this.surroundingVisibility);
    const switchProgress =
      this.switchRevealTime > 0 ? 1 - this.switchRevealTime / this.SWITCH_REVEAL_DURATION : 1;
    gl.uniform1f(this.discLocations.uSwitchProgress, Math.min(1, Math.max(0, switchProgress)));
    const isDragTransitioning = this.isDragTransitioning;
    const isAutoSwitching =
      !isDragTransitioning && (this.#manualSnapVertex >= 0 || this.switchRevealTime > 0);
    gl.uniform1f(this.discLocations.uAutoSwitching, isAutoSwitching ? 1 : 0);
    gl.uniform1f(this.discLocations.uDragging, isDragTransitioning ? 1 : 0);
    gl.uniform1f(this.discLocations.uAudioBass, this.audioBass);
    gl.uniform1f(this.discLocations.uAudioMid, this.audioMid);
    gl.uniform1f(this.discLocations.uAudioTreble, this.audioTreble);
    gl.uniform1f(this.discLocations.uGrabProgress, this.grabProgress);
    gl.uniform1f(
      this.discLocations.uDragCommitProgress,
      this.dragSettleActive && this.dragSettleShouldCommit
        ? this.dragSettleProgress
        : 0
    );
    const dragOffsetX = this.dragSettleActive
      ? this.dragSettleOffset[0]
      : this.control.hasDragged
        ? (this.control.dragOffsetX / Math.max(1, this.canvas.clientWidth)) * 2
        : 0;
    const dragOffsetY = this.dragSettleActive
      ? this.dragSettleOffset[1]
      : this.control.hasDragged
        ? (-this.control.dragOffsetY / Math.max(1, this.canvas.clientHeight)) * 2
        : 0;
    gl.uniform2f(this.discLocations.uDragOffset, dragOffsetX, dragOffsetY);

    gl.uniform1f(this.discLocations.uFrames, this.#frames);
    gl.uniform1f(this.discLocations.uScaleFactor, this.scaleFactor);
    gl.uniform1i(this.discLocations.uTex, 0);
    gl.uniform1i(this.discLocations.uSurfaceTex, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTex);

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
    // 取景范围越大，中央音乐星球在画面里越小；为左右标题和歌词保留呼吸空间
    const height = this.SPHERE_RADIUS * 0.55;
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
    const baseCameraZ = 3 * this.scaleFactor;
    const isPointerDown = this.control.isPointerDown;
    const isActivelyDragging = isPointerDown && this.control.hasDragged;
    const justPressed = isPointerDown && !this.wasPointerDown;
    const justReleased = !isPointerDown && this.wasPointerDown;
    let cameraHandledBySettle = false;

    if (
      !isPointerDown
      && this.interactionPhase === 'auto'
      && this.#manualSnapVertex < 0
      && this.switchRevealTime <= 0
    ) {
      this.#setInteractionPhase('idle');
    }

    if (justPressed) {
      // 新的按住动作立即接管画面。如果上一段收尾尚未完成，先落到准确终点，
      // 避免两条动画同时修改朝向，造成肉眼看到的“抽一下”。
      if (this.dragSettleActive) {
        quat.copy(this.control.orientation, this.dragSettleTargetOrientation);
        this.control.stopInertia();
        this.activeDiscIndex = this.dragSettleTargetDiscIndex;
        if (this.dragSettleShouldCommit && this.dragSettleTargetDiscIndex >= 0) {
          this.#reportActiveVertex(this.dragSettleTargetDiscIndex);
        }
        this.dragSettleActive = false;
        this.dragSettleProgress = 0;
        this.dragSettleShouldCommit = false;
      }

      // 按下的第一帧就停止旧惯性和按钮吸附；此后只有本次抓取能控制朝向。
      this.control.stopInertia();
      this.control.snapTargetDirection = null;
      this.#manualSnapVertex = -1;
      this.switchRevealTime = 0;
      this.previousDiscIndex = -1;
      this.dragOriginDiscIndex =
        this.activeDiscIndex >= 0 ? this.activeDiscIndex : this.#findNearestVertexIndex();
      this.dragPreviewDiscIndex = -1;
      quat.copy(this.dragOriginOrientation, this.control.orientation);
      this.#setInteractionPhase('holding');
    }

    // 松手后由同一条 260ms 时间线同时处理位置、球体朝向、后缩和镜头恢复。
    // 成功切歌不再追加第二段吸附，所以新封面落位后不会再突然动一下。
    if (justReleased && this.#manualSnapVertex < 0) {
      let previewTarget = this.dragOriginDiscIndex;
      let releaseOffset = vec2.create();
      let shouldCommit = false;

      if (this.control.hasDragged) {
        previewTarget =
          this.dragPreviewDiscIndex >= 0
            ? this.dragPreviewDiscIndex
            : this.#findDragPreviewVertexIndex(this.dragOriginDiscIndex);
        releaseOffset = vec2.fromValues(
          (this.control.dragOffsetX / Math.max(1, this.canvas.clientWidth)) * 2,
          (-this.control.dragOffsetY / Math.max(1, this.canvas.clientHeight)) * 2
        );
        const releaseDistance = vec2.length(releaseOffset);
        shouldCommit =
          previewTarget >= 0 && releaseDistance >= this.dragCommitDistance;
        const releaseDirection =
          releaseDistance > 0.0001
            ? vec2.scale(vec2.create(), releaseOffset, 1 / releaseDistance)
            : vec2.fromValues(-1, 0);

        vec2.copy(this.dragSettleStartOffset, releaseOffset);
        if (shouldCommit) {
          // 成功切歌只沿当前方向再走一小段，绝不反向回拉。
          vec2.scaleAndAdd(
            this.dragSettleTargetOffset,
            releaseOffset,
            releaseDirection,
            0.18
          );
        } else {
          vec2.set(this.dragSettleTargetOffset, 0, 0);
        }
      } else {
        vec2.set(this.dragSettleStartOffset, 0, 0);
        vec2.set(this.dragSettleTargetOffset, 0, 0);
      }

      vec2.copy(this.dragSettleOffset, releaseOffset);
      this.dragSettleTargetDiscIndex = shouldCommit
        ? previewTarget
        : this.dragOriginDiscIndex;
      this.dragSettleElapsed = 0;
      this.dragSettleProgress = 0;
      this.dragSettleShouldCommit = shouldCommit;
      this.dragSettleActive = true;
      this.#setInteractionPhase('settling');
      this.dragSettleStartGrabProgress = this.grabProgress;
      this.dragSettleStartCameraZ = this.camera.position[2];
      quat.copy(this.dragSettleStartOrientation, this.control.orientation);

      if (shouldCommit) {
        const targetDirection = vec3.normalize(
          vec3.create(),
          this.#getVertexWorldPosition(this.dragSettleTargetDiscIndex)
        );
        const alignment = quat.rotationTo(
          quat.create(),
          targetDirection,
          this.control.snapDirection
        );
        quat.multiply(
          this.dragSettleTargetOrientation,
          alignment,
          this.control.orientation
        );
        quat.normalize(
          this.dragSettleTargetOrientation,
          this.dragSettleTargetOrientation
        );
      } else {
        quat.copy(this.dragSettleTargetOrientation, this.dragOriginOrientation);
      }

      this.control.stopInertia();
      this.control.snapTargetDirection = null;
      this.activeDiscIndex = this.dragOriginDiscIndex;
    }

    if (this.dragSettleActive && !isPointerDown) {
      this.dragSettleElapsed += deltaTime;
      const progress = Math.min(1, this.dragSettleElapsed / this.dragSettleDuration);
      const ease = 1 - Math.pow(1 - progress, 3);
      this.dragSettleProgress = ease;
      vec2.lerp(
        this.dragSettleOffset,
        this.dragSettleStartOffset,
        this.dragSettleTargetOffset,
        ease
      );
      quat.slerp(
        this.control.orientation,
        this.dragSettleStartOrientation,
        this.dragSettleTargetOrientation,
        ease
      );
      quat.normalize(this.control.orientation, this.control.orientation);
      this.grabProgress = this.dragSettleStartGrabProgress * (1 - ease);
      this.camera.position[2] =
        this.dragSettleStartCameraZ
        + (baseCameraZ - this.dragSettleStartCameraZ) * ease;
      cameraHandledBySettle = true;
      this.activeDiscIndex = this.dragOriginDiscIndex;

      if (progress >= 1) {
        const settledTarget = this.dragSettleTargetDiscIndex;
        const shouldCommit = this.dragSettleShouldCommit;
        quat.copy(this.control.orientation, this.dragSettleTargetOrientation);
        this.control.stopInertia();
        this.control.snapTargetDirection = null;
        this.activeDiscIndex = settledTarget;
        this.dragPreviewDiscIndex = -1;
        this.dragSettleActive = false;
        this.dragSettleProgress = 0;
        this.dragSettleShouldCommit = false;
        this.grabProgress = 0;
        this.camera.position[2] = baseCameraZ;
        if (shouldCommit && settledTarget >= 0) {
          this.#reportActiveVertex(settledTarget);
        }
        this.#setInteractionPhase('idle');
      }
    } else if (!isPointerDown) {
      if (this.#manualSnapVertex >= 0) {
        // 手动选曲吸附：旋转到目标星球，期间不触发 onActiveItemChange
        this.activeDiscIndex = this.#manualSnapVertex;
        const snapDirection = vec3.normalize(vec3.create(), this.#getVertexWorldPosition(this.#manualSnapVertex));
        this.control.snapTargetDirection = snapDirection;
        // 接近目标后结束手动吸附，恢复正常吸附并触发一次激活变更
        if (vec3.dot(snapDirection, this.control.snapDirection) > 0.99) {
          this.#reportActiveVertex(this.#manualSnapVertex);
          this.#manualSnapVertex = -1;
        }
      } else {
        const nearestVertexIndex = this.#findNearestVertexIndex();
        this.activeDiscIndex = nearestVertexIndex;
        this.#reportActiveVertex(nearestVertexIndex);
        const snapDirection = vec3.normalize(vec3.create(), this.#getVertexWorldPosition(nearestVertexIndex));
        this.control.snapTargetDirection = snapDirection;
      }
    } else if (isActivelyDragging) {
      this.#setInteractionPhase('dragging');
      // 真正越过拖动门槛后才取消按钮切歌，并开始预览邻近星球。
      this.#manualSnapVertex = -1;
      this.switchRevealTime = 0;
      this.previousDiscIndex = -1;

      // 一次拖动只允许预览相邻的一首，拖得再远也不会连续跨过多颗星球。
      // 中央 activeDiscIndex 仍锁定在按下前的歌曲，不会跟着拖动乱换。
      this.dragPreviewDiscIndex = this.#findDragPreviewVertexIndex(this.dragOriginDiscIndex);
      // 预览阶段绝不替换中央星球，真正的歌曲提交只发生在 pointerup。
      this.activeDiscIndex = this.dragOriginDiscIndex;
    } else {
      // 仍处于防误触范围：保持按下前的封面，但后缩从按下第一帧开始。
      this.activeDiscIndex = this.dragOriginDiscIndex;
      this.dragPreviewDiscIndex = -1;
    }

    if (!cameraHandledBySettle) {
      const grabTarget = isPointerDown ? 1 : 0;
      const grabDuration = isPointerDown ? 62 : 180;
      const grabBlend = 1 - Math.exp(-deltaTime / grabDuration);
      this.grabProgress += (grabTarget - this.grabProgress) * grabBlend;

      const cameraTargetZ = baseCameraZ + this.grabProgress * 0.52;
      const cameraBlend = 1 - Math.exp(-deltaTime / (isPointerDown ? 76 : 190));
      this.camera.position[2] +=
        (cameraTargetZ - this.camera.position[2]) * cameraBlend;
    }

    this.#updateCameraMatrix();
    this.wasPointerDown = isPointerDown;
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

  #findDragPreviewVertexIndex(currentIndex) {
    if (currentIndex < 0 || this.items.length < 2) return -1;

    const horizontalTravel = this.control.dragOffsetX;
    const verticalTravel = this.control.dragOffsetY;
    const dominantTravel =
      Math.abs(horizontalTravel) >= Math.abs(verticalTravel)
        ? horizontalTravel
        : verticalTravel;
    // 内容跟随手指：向左/向上拖时，下一首从反方向进入；反向则预览上一首。
    const itemStep = dominantTravel < 0 ? 1 : -1;
    const itemCount = this.items.length;
    const currentItemIndex = currentIndex % itemCount;
    const previewItemIndex = (currentItemIndex + itemStep + itemCount) % itemCount;

    const n = this.control.snapDirection;
    let bestVertexIndex = -1;
    let bestDot = -2;
    for (let i = 0; i < this.instancePositions.length; ++i) {
      if (i % itemCount !== previewItemIndex) continue;
      const worldPosition = this.#getVertexWorldPosition(i);
      const dot = vec3.dot(vec3.normalize(vec3.create(), worldPosition), n);
      if (dot > bestDot) {
        bestDot = dot;
        bestVertexIndex = i;
      }
    }
    return bestVertexIndex;
  }

  #getVertexWorldPosition(index) {
    const nearestVertexPos = this.instancePositions[index];
    return vec3.transformQuat(vec3.create(), nearestVertexPos, this.control.orientation);
  }

  setAudioLevels(bass, mid, treble) {
    this.audioBass = bass;
    this.audioMid = mid;
    this.audioTreble = treble;
  }

  /** 旋转宇宙层，使映射到 itemIndex 的星球朝向相机 */
  snapToItem(itemIndex) {
    this.dragSettleActive = false;
    this.dragSettleProgress = 0;
    this.dragSettleShouldCommit = false;
    this.dragPreviewDiscIndex = -1;
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
    this.previousDiscIndex = this.activeDiscIndex;
    this.#manualSnapVertex = best;
    this.#setInteractionPhase('auto');
    // 即使目标星球距离很近，也保留一小段远景显现时间，避免切换像瞬间换贴图
    this.switchRevealTime = this.SWITCH_REVEAL_DURATION;
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
      } catch {
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
 * @param {(isPlaying: boolean) => void} [props.onPlayingChange]
 * @param {(hue: number) => void} [props.onColorChange]
 * @param {(isMoving: boolean) => void} [props.onMovementChange]
 * @param {(progress: number) => void} [props.onProgressChange] 0 到 1 的歌曲进度
 */
export default function InfiniteMenu({ items = [], scale = 1.0, audioSrc, lrcSrc, onPlayingChange, onColorChange, onMovementChange, onProgressChange }) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const audioAnalysisFrameRef = useRef(0);
  const audioLevelsRef = useRef({ bass: 0, mid: 0, treble: 0 });
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
  const songProgress = duration > 0
    ? Math.min(1, Math.max(0, currentTime / duration))
    : 0;
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

  // 第一次由用户播放时才创建音频分析器，避免浏览器的自动播放限制。
  // 分析结果只保留低/中/高三个平滑值，不渲染密集频谱条。
  const startAudioAnalysis = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') return;

    if (audioContextRef.current) {
      audioContextRef.current.resume?.().catch(() => {});
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.84;

    let source;
    try {
      source = context.createMediaElementSource(audio);
    } catch {
      context.close().catch(() => {});
      return;
    }

    source.connect(analyser);
    analyser.connect(context.destination);
    audioContextRef.current = context;
    audioSourceRef.current = source;
    audioAnalyserRef.current = analyser;

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const binHz = context.sampleRate / analyser.fftSize;
    let lastSampleAt = 0;

    const readBand = (fromHz, toHz) => {
      const start = Math.max(1, Math.floor(fromHz / binHz));
      const end = Math.min(frequencyData.length, Math.ceil(toHz / binHz));
      if (end <= start) return 0;
      let sum = 0;
      for (let i = start; i < end; i++) sum += frequencyData[i];
      const raw = sum / (end - start) / 255;
      return Math.min(1, Math.max(0, (raw - 0.045) / 0.68));
    };

    const updateAnalysis = now => {
      audioAnalysisFrameRef.current = requestAnimationFrame(updateAnalysis);
      // 30fps 足够表现音乐呼吸，也比逐帧改 DOM 更稳定。
      if (now - lastSampleAt < 1000 / 30) return;
      lastSampleAt = now;

      analyser.getByteFrequencyData(frequencyData);
      const silent = audio.paused || audio.ended;
      const targets = silent
        ? { bass: 0, mid: 0, treble: 0 }
        : {
            bass: readBand(45, 180),
            mid: readBand(180, 2200),
            treble: readBand(2200, 9000)
          };
      const levels = audioLevelsRef.current;

      for (const band of ['bass', 'mid', 'treble']) {
        const target = targets[band];
        const response = target > levels[band] ? 0.2 : 0.065;
        levels[band] += (target - levels[band]) * response;
      }

      const shell = shellRef.current;
      if (shell) {
        shell.style.setProperty('--audio-bass', levels.bass.toFixed(4));
        shell.style.setProperty('--audio-mid', levels.mid.toFixed(4));
        shell.style.setProperty('--audio-treble', levels.treble.toFixed(4));
      }
      sketchRef.current?.setAudioLevels(levels.bass, levels.mid, levels.treble);
    };

    audioAnalysisFrameRef.current = requestAnimationFrame(updateAnalysis);
    context.resume().catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(audioAnalysisFrameRef.current);
      audioSourceRef.current?.disconnect();
      audioAnalyserRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

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
      sketch?.destroy();
      if (sketchRef.current === sketch) {
        sketchRef.current = null;
      }
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

  // 复用音频进度改变整片环带的厚度，暂停、拖动和切歌都会保持同步
  useEffect(() => {
    onProgressChange?.(songProgress);
  }, [onProgressChange, songProgress]);

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
        startAudioAnalysis();
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
          video: {
            width: { ideal: 480 },
            height: { ideal: 360 },
            facingMode: 'user'
          }
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        let lastVideoTime = -1;
        let lastDetectionAt = -Infinity;
        const detectionInterval = 1000 / 24;
        const loop = now => {
          if (cancelled) return;
          rafId = requestAnimationFrame(loop);
          if (
            !video
            || video.readyState < 2
            || video.currentTime === lastVideoTime
            || now - lastDetectionAt < detectionInterval
          ) {
            return;
          }
          lastDetectionAt = now;
          lastVideoTime = video.currentTime;
          handleResult(landmarker.detectForVideo(video, now));
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
  }, [gestureOn, startAudioAnalysis]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      startAudioAnalysis();
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
    startAudioAnalysis();
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
    // 旋转星系到对应星球，让 3D 星球完成空间切换
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

  // 进度光尘只沿土星环可见的前半圈移动，避免穿过星球表面。
  const ringProgressAngle = Math.PI * (0.08 + songProgress * 0.84);
  const ringProgressBeaconStyle = {
    left: `${50 + Math.cos(ringProgressAngle) * 48.5}%`,
    top: `${50 + Math.sin(ringProgressAngle) * 47}%`
  };

  return (
    <div ref={shellRef} className={`infinite-menu-shell${isPlaying ? ' is-playing' : ''}`}>
      <canvas id="infinite-grid-menu-canvas" ref={canvasRef} />

      {activeItem && (
        <div className={`planet-ring-front${isMoving ? ' inactive' : ''}`} aria-hidden="true">
          <span className="ring-progress-beacon" style={ringProgressBeaconStyle} />
        </div>
      )}

      <audio ref={audioRef} src={currentAudio || undefined} preload="auto" />

      {activeItem && (
        <>
          <h2
            className={`face-title ${isMoving ? 'inactive' : 'active'}`}
            data-title={activeItem.title}
          >
            {activeItem.title}
          </h2>

          <p
            className={`face-artist ${isMoving ? 'inactive' : 'active'}`}
          >
            {activeItem.artist}
          </p>
        </>
      )}

      {lyrics.length > 0 && (
        <div ref={lyricsPanelRef} className={`lyrics-panel ${isMoving ? 'inactive' : 'active'}`}>
          <div
            className="lyrics-track"
            style={{
              transform: `translateY(${(panelHeight / 2 - (lineHeights.slice(0, activeLyricIndex).reduce((sum, h) => sum + h, 0) + (lineHeights[activeLyricIndex] || 0) / 2)).toFixed(1)}px)`
            }}
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
          <div className="player-now-playing" aria-live="polite">
            <span className={`player-state-dot${isPlaying ? ' on' : ''}`} aria-hidden="true" />
            <span className="player-now-title">{song?.title || activeItem?.title || '未知歌曲'}</span>
            {(song?.artist || activeItem?.artist) && (
              <>
                <span className="player-now-divider" aria-hidden="true" />
                <span className="player-now-artist">{song?.artist || activeItem?.artist}</span>
              </>
            )}
          </div>

          <div className="player-command-row">
            <div className="player-utility-group player-utility-left" aria-label="扩展功能">
              <button type="button" className="player-tool-button" aria-label="沉浸模式" title="沉浸模式">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
                </svg>
              </button>
              <button type="button" className="player-tool-button" aria-label="收藏" title="收藏">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" />
                </svg>
              </button>
              <button type="button" className="player-tool-button has-badge" aria-label="评论" title="评论">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M20 14a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.6V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v6Z" />
                  <path d="M8 11h.01M12 11h.01M16 11h.01" />
                </svg>
                <span className="player-tool-badge">999+</span>
              </button>
              <button type="button" className="player-tool-button" aria-label="更多" title="更多">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M8 12h.01M12 12h.01M16 12h.01" />
                </svg>
              </button>
            </div>

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

            <div className="player-utility-group player-utility-right" aria-label="播放工具">
              <button type="button" className="player-tool-button" aria-label="视觉皮肤" title="视觉皮肤">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="m8 4 4-2 4 2 4 1.5-2.2 5-2.3-1.1V21h-7V9.4l-2.3 1.1L4 5.5 8 4Z" />
                </svg>
              </button>
              <button type="button" className="player-tool-button text-tool" aria-label="音质" title="音质">
                <span>HQ</span>
              </button>
              <button type="button" className="player-tool-button effects-tool" aria-label="音效" title="音效">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 14v-4M8 18V6M12 15V9M16 20V4M20 14v-4" />
                </svg>
                <span className="player-tool-micro">OFF</span>
              </button>
              <button type="button" className="player-tool-button text-tool lyrics-tool" aria-label="歌词" title="歌词">
                <span>词</span>
              </button>
              <button type="button" className="player-tool-button" aria-label="播放列表" title="播放列表">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 6h11M4 11h11M4 16h7" />
                  <path d="m16 14 5 3-5 3v-6Z" />
                </svg>
              </button>
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
        aria-pressed={gestureOn}
      >
        <span className="gesture-toggle-dot" aria-hidden="true" />
        <span>{gestureOn ? '关闭手势' : '手势控制'}</span>
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
