import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface Scanning3DOverlayProps {
  active: boolean;
  title?: string;
  subtitle?: string;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createProceduralDocumentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 680;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header band
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(36, 36, 440, 66);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(52, 54, 150, 12);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(52, 74, 96, 8);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(360, 56, 98, 22);

    // Metadata rows
    ctx.fillStyle = '#cbd5e1';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(42, 134 + i * 24, 210 - (i % 2) * 35, 10);
      ctx.fillRect(300, 134 + i * 24, 170, 10);
    }

    // Table header
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(36, 250, 440, 32);

    // Line items
    for (let r = 0; r < 6; r++) {
      const y = 300 + r * 36;
      ctx.fillStyle = r % 2 === 0 ? '#f1f5f9' : '#ffffff';
      ctx.fillRect(36, y - 6, 440, 28);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(46, y + 4, 190, 9);
      ctx.fillStyle = '#475569';
      ctx.fillRect(310, y + 4, 54, 9);
      ctx.fillRect(395, y + 4, 68, 9);
    }

    // Total & hash footer
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 535, 440, 96);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(54, 558, 120, 16);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(340, 556, 118, 20);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(54, 594, 380, 10);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const Scanning3DOverlay: React.FC<Scanning3DOverlayProps> = ({
  active,
  title = 'Running Forensic Document Scan',
  subtitle = 'Inspecting cryptographic hashes, metadata, visual ELA residuals, OCR text, and consistency rules...',
}) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = canvasHostRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      const isSoftwareGl = detectSoftwareWebGL();
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);

      const width = container.clientWidth || 440;
      const height = container.clientHeight || 280;
      renderer.setSize(width, height);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, width / Math.max(1, height), 0.1, 100);
      camera.position.set(0, 0.35, 7.2);
      camera.lookAt(0, 0, 0);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      pmremGenerator.dispose();

      // Studio lighting
      const ambient = new THREE.AmbientLight(0xe0f2fe, 0.75);
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(4, 6, 7);
      const cyanLight = new THREE.PointLight(0x0ea5e9, 2.2, 12);
      cyanLight.position.set(0, 0, 3);
      scene.add(ambient, keyLight, cyanLight);

      // Composite Multi-Part Scanner Assembly (THREE.Group)
      const scannerGroup = new THREE.Group();
      scene.add(scannerGroup);

      // Part 1: Beveled 3D Document Body + Procedural Document Sheet Face
      const docShape = new THREE.Shape();
      docShape.moveTo(-1.15, -1.55);
      docShape.lineTo(0.8, -1.55);
      docShape.lineTo(1.15, -1.2);
      docShape.lineTo(1.15, 1.55);
      docShape.lineTo(-1.15, 1.55);
      docShape.closePath();

      const slabGeo = new THREE.ExtrudeGeometry(docShape, {
        depth: 0.09,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.025,
        bevelSegments: 3,
      });
      slabGeo.center();
      const slabMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.65,
        roughness: 0.3,
      });
      const docSlab = new THREE.Mesh(slabGeo, slabMat);
      scannerGroup.add(docSlab);

      const docTex = createProceduralDocumentTexture();
      const faceGeo = new THREE.PlaneGeometry(2.12, 2.86);
      const faceMat = new THREE.MeshStandardMaterial({
        map: docTex,
        roughness: 0.55,
        metalness: 0.08,
      });
      const faceFront = new THREE.Mesh(faceGeo, faceMat);
      faceFront.position.z = 0.075;
      scannerGroup.add(faceFront);

      const faceBack = new THREE.Mesh(faceGeo, faceMat);
      faceBack.position.z = -0.075;
      faceBack.rotation.y = Math.PI;
      scannerGroup.add(faceBack);

      // Part 2: Four Corner Sensor Brackets (Machined Metallic Accents)
      const bracketGeo = new THREE.BoxGeometry(0.32, 0.08, 0.22);
      const bracketMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.85,
        roughness: 0.2,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35,
      });
      const cornerOffsets: Array<[number, number]> = [
        [-1.18, 1.58],
        [1.18, 1.58],
        [-1.18, -1.58],
        [1.18, -1.58],
      ];
      cornerOffsets.forEach(([cx, cy]) => {
        const bracket = new THREE.Mesh(bracketGeo, bracketMat);
        bracket.position.set(cx, cy, 0);
        scannerGroup.add(bracket);
      });

      // Part 3: Dual Concentric Holographic Verification Rings
      const outerRingGeo = new THREE.TorusGeometry(2.35, 0.032, 16, 96);
      const outerRingMat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        metalness: 0.8,
        roughness: 0.22,
        emissive: 0x1d4ed8,
        emissiveIntensity: 0.55,
      });
      const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
      outerRing.rotation.x = Math.PI * 0.36;
      scene.add(outerRing);

      const innerRingGeo = new THREE.TorusGeometry(1.98, 0.024, 16, 84);
      const innerRingMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.75,
        roughness: 0.25,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.75,
      });
      const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
      innerRing.rotation.y = Math.PI * 0.32;
      scene.add(innerRing);

      // Part 4: Animated Laser Scan Beam & Glow Field Sweeping Vertically
      const scanBarGroup = new THREE.Group();
      const beamGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.75, 16);
      beamGeo.rotateZ(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.95,
      });
      const beamMesh = new THREE.Mesh(beamGeo, beamMat);
      scanBarGroup.add(beamMesh);

      const haloGeo = new THREE.PlaneGeometry(2.7, 0.42);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
      });
      const haloPlane = new THREE.Mesh(haloGeo, haloMat);
      haloPlane.position.z = 0.02;
      scanBarGroup.add(haloPlane);

      scanBarGroup.position.z = 0.14;
      scannerGroup.add(scanBarGroup);

      // Part 5: Orbiting Forensic Verification Particles
      const particleCount = 32;
      const pGeo = new THREE.OctahedronGeometry(0.055, 0);
      const pMat = new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0284c7,
        emissiveIntensity: 0.65,
        metalness: 0.4,
        roughness: 0.3,
      });
      const particles = new THREE.InstancedMesh(pGeo, pMat, particleCount);
      const dummy = new THREE.Object3D();
      scene.add(particles);

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth || 440;
        const h = Math.max(1, container.clientHeight || 280);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      let disposed = false;
      let frameId = 0;
      const clock = new THREE.Clock();

      const updateScene = (elapsed: number) => {
        scannerGroup.rotation.y = Math.sin(elapsed * 0.9) * 0.42;
        scannerGroup.rotation.x = Math.cos(elapsed * 0.65) * 0.09;

        const scanY = Math.sin(elapsed * 2.2) * 1.38;
        scanBarGroup.position.y = scanY;
        cyanLight.position.y = scanY;

        outerRing.rotation.z = elapsed * 0.55;
        outerRing.rotation.y = elapsed * 0.25;
        innerRing.rotation.z = -elapsed * 0.75;
        innerRing.rotation.x = Math.PI * 0.28 + Math.sin(elapsed * 0.5) * 0.2;

        for (let i = 0; i < particleCount; i++) {
          const a = (i / particleCount) * Math.PI * 2 + elapsed * 0.85;
          const r = 2.15 + (i % 3) * 0.28;
          dummy.position.set(
            Math.cos(a) * r,
            Math.sin(elapsed * 1.4 + i) * 1.35,
            Math.sin(a) * r * 0.65
          );
          dummy.rotation.set(elapsed + i, elapsed * 0.7, 0);
          dummy.scale.setScalar(0.8 + ((i * 3) % 4) * 0.15);
          dummy.updateMatrix();
          particles.setMatrixAt(i, dummy.matrix);
        }
        particles.instanceMatrix.needsUpdate = true;
      };

      const afterDraw = (cb: () => void) => {
        try {
          const gl = renderer.getContext() as WebGL2RenderingContext;
          if (!gl || typeof gl.fenceSync !== 'function') {
            frameId = window.setTimeout(cb, 80);
            return;
          }
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) {
              if (sync) gl.deleteSync(sync);
              return;
            }
            const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (state === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 5);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 80);
            }
          };
          frameId = window.setTimeout(poll, 5);
        } catch {
          frameId = window.setTimeout(cb, 80);
        }
      };

      const tick = () => {
        if (disposed) return;
        updateScene(clock.getElapsedTime());
        renderer.render(scene, camera);
        if (prefersReducedMotion) return;
        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      };

      updateScene(0);
      renderer.render(scene, camera);
      if (!prefersReducedMotion) {
        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      }

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        window.removeEventListener('resize', handleResize);
        slabGeo.dispose();
        faceGeo.dispose();
        bracketGeo.dispose();
        outerRingGeo.dispose();
        innerRingGeo.dispose();
        beamGeo.dispose();
        haloGeo.dispose();
        pGeo.dispose();
        docTex.dispose();
        slabMat.dispose();
        faceMat.dispose();
        bracketMat.dispose();
        outerRingMat.dispose();
        innerRingMat.dispose();
        beamMat.dispose();
        haloMat.dispose();
        pMat.dispose();
        envTexture.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
    } catch {
      return undefined;
    }
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-6 text-center shadow-2xl">
        <div
          ref={canvasHostRef}
          className="w-full h-64 rounded-xl bg-slate-950/70 border border-slate-800 overflow-hidden"
        />
        <h3 className="mt-4 text-base font-bold text-white">{title}</h3>
        <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
};
