import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface Background3DProps {
  variant?: 'workspace' | 'auth';
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

export const Background3D: React.FC<Background3DProps> = ({ variant = 'workspace' }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
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
      renderer.toneMappingExposure = 1.05;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, width / Math.max(1, height), 0.1, 100);
      camera.position.set(0, 0.6, 15.5);

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      pmremGenerator.dispose();

      // Lighting rig
      const ambient = new THREE.AmbientLight(0xdbeafe, 0.7);
      const keyLight = new THREE.DirectionalLight(0x93c5fd, 1.4);
      keyLight.position.set(8, 12, 10);
      const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
      rimLight.position.set(-10, -4, 6);
      scene.add(ambient, keyLight, rimLight);

      // Composite architectural verification core (Group of multi-scale rings & faceted prism)
      const latticeGroup = new THREE.Group();
      latticeGroup.position.set(variant === 'auth' ? -2.2 : 4.2, 0.4, -2.5);
      scene.add(latticeGroup);

      const ringMatOuter = new THREE.MeshStandardMaterial({
        color: variant === 'auth' ? 0x3b82f6 : 0x2563eb,
        metalness: 0.72,
        roughness: 0.28,
        transparent: true,
        opacity: variant === 'auth' ? 0.38 : 0.24,
      });
      const ringMatInner = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        metalness: 0.65,
        roughness: 0.35,
        transparent: true,
        opacity: variant === 'auth' ? 0.32 : 0.2,
      });

      const outerTorusGeo = new THREE.TorusGeometry(4.2, 0.045, 16, 96);
      const outerTorus = new THREE.Mesh(outerTorusGeo, ringMatOuter);
      outerTorus.rotation.x = Math.PI * 0.28;
      latticeGroup.add(outerTorus);

      const midTorusGeo = new THREE.TorusGeometry(3.15, 0.035, 16, 80);
      const midTorus = new THREE.Mesh(midTorusGeo, ringMatInner);
      midTorus.rotation.y = Math.PI * 0.35;
      latticeGroup.add(midTorus);

      const coreGeo = new THREE.IcosahedronGeometry(1.75, 1);
      const coreWireGeo = new THREE.WireframeGeometry(coreGeo);
      const coreWireMat = new THREE.LineBasicMaterial({
        color: variant === 'auth' ? 0x60a5fa : 0x3b82f6,
        transparent: true,
        opacity: variant === 'auth' ? 0.32 : 0.18,
      });
      const coreWire = new THREE.LineSegments(coreWireGeo, coreWireMat);
      latticeGroup.add(coreWire);

      // Subtle beveled floating verification plates (3 document silhouettes)
      const plateShape = new THREE.Shape();
      plateShape.moveTo(-0.7, -0.95);
      plateShape.lineTo(0.45, -0.95);
      plateShape.lineTo(0.7, -0.7);
      plateShape.lineTo(0.7, 0.95);
      plateShape.lineTo(-0.7, 0.95);
      plateShape.closePath();

      const plateGeo = new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.06,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2,
      });
      plateGeo.center();

      const plateMat = new THREE.MeshStandardMaterial({
        color: variant === 'auth' ? 0x1e3a8a : 0x94a3b8,
        metalness: 0.35,
        roughness: 0.45,
        transparent: true,
        opacity: variant === 'auth' ? 0.34 : 0.18,
      });

      const plates: Array<{ mesh: THREE.Mesh; baseY: number; speed: number; phase: number }> = [];
      const plateCoords: Array<[number, number, number]> = [
        [-6.4, 2.2, -4.0],
        [6.8, -2.1, -3.5],
        [0.4, -3.2, -5.2],
      ];
      plateCoords.forEach(([px, py, pz], idx) => {
        const mesh = new THREE.Mesh(plateGeo, plateMat);
        mesh.position.set(px, py, pz);
        mesh.rotation.set(0.2 * (idx + 1), -0.35 + idx * 0.25, 0.08 * idx);
        scene.add(mesh);
        plates.push({ mesh, baseY: py, speed: 0.5 + idx * 0.15, phase: idx * 1.9 });
      });

      // Instanced geometric verification nodes floating in depth
      const nodeCount = 56;
      const nodeGeo = new THREE.OctahedronGeometry(0.11, 0);
      const nodeMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: variant === 'auth' ? 0.55 : 0.32,
      });
      const nodes = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
      const dummy = new THREE.Object3D();
      const palette = [
        new THREE.Color(0x2563eb),
        new THREE.Color(0x0ea5e9),
        new THREE.Color(0x64748b),
      ];
      const nodeSeeds = Array.from({ length: nodeCount }, (_, i) => {
        const angle = (i / nodeCount) * Math.PI * 2;
        const radius = 5.5 + ((i * 17) % 10) * 0.7;
        const y = (((i * 29) % 20) - 10) * 0.55;
        const z = -6 + ((i * 13) % 9);
        const scale = 0.7 + ((i * 7) % 5) * 0.16;
        nodes.setColorAt(i, palette[i % palette.length]);
        return { angle, radius, y, z, scale, speed: 0.05 + (i % 5) * 0.015 };
      });
      if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
      scene.add(nodes);

      // Subtle spatial grid horizon at bottom
      const gridHelper = new THREE.GridHelper(
        34,
        28,
        variant === 'auth' ? 0x1d4ed8 : 0xcbd5e1,
        variant === 'auth' ? 0x1e293b : 0xe2e8f0
      );
      gridHelper.position.set(0, -5.8, -4);
      const gridMats = Array.isArray(gridHelper.material)
        ? gridHelper.material
        : [gridHelper.material];
      gridMats.forEach((m) => {
        m.transparent = true;
        m.opacity = variant === 'auth' ? 0.28 : 0.35;
      });
      scene.add(gridHelper);

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = Math.max(1, container.clientHeight || window.innerHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      let disposed = false;
      let frameId = 0;
      const clock = new THREE.Clock();

      const updateScene = (elapsed: number) => {
        latticeGroup.rotation.y = elapsed * 0.12;
        latticeGroup.rotation.z = Math.sin(elapsed * 0.25) * 0.08;
        outerTorus.rotation.y = elapsed * 0.18;
        midTorus.rotation.x = elapsed * 0.22;
        coreWire.rotation.y = -elapsed * 0.16;
        coreWire.rotation.x = elapsed * 0.09;

        for (const p of plates) {
          p.mesh.position.y = p.baseY + Math.sin(elapsed * p.speed + p.phase) * 0.38;
          p.mesh.rotation.y += 0.0025;
        }

        for (let i = 0; i < nodeCount; i++) {
          const s = nodeSeeds[i];
          const a = s.angle + elapsed * s.speed;
          dummy.position.set(
            Math.cos(a) * s.radius,
            s.y + Math.sin(elapsed * 0.6 + i) * 0.25,
            s.z + Math.sin(a) * 1.4
          );
          dummy.rotation.set(elapsed * 0.4 + i, elapsed * 0.3, 0);
          dummy.scale.setScalar(s.scale);
          dummy.updateMatrix();
          nodes.setMatrixAt(i, dummy.matrix);
        }
        nodes.instanceMatrix.needsUpdate = true;
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
        const elapsed = clock.getElapsedTime();
        updateScene(elapsed);
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
        outerTorusGeo.dispose();
        midTorusGeo.dispose();
        coreGeo.dispose();
        coreWireGeo.dispose();
        plateGeo.dispose();
        nodeGeo.dispose();
        ringMatOuter.dispose();
        ringMatInner.dispose();
        coreWireMat.dispose();
        plateMat.dispose();
        nodeMat.dispose();
        gridHelper.geometry.dispose();
        gridMats.forEach((m) => m.dispose());
        envTexture.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
    } catch {
      return undefined;
    }
  }, [variant]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
    />
  );
};
