"use client";

import NextImage from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { HomeMarket } from "@/ui/home-globe";

interface ThreeGlobeProps {
  markets: HomeMarket[];
  activeMarket?: HomeMarket;
  onHover: (market: HomeMarket) => void;
  onLeave: () => void;
  onSelect: (market: HomeMarket) => void;
}

const INDIA_CENTER_ROTATION = -Math.PI / 2 - 70 * Math.PI / 180;
// The CC0 raster's painted geography begins slightly east of its nominal
// equirectangular seam. Register all geographic markers to that map once,
// rather than applying per-destination visual nudges.
const MAP_LONGITUDE_REGISTRATION = -9.8;

export default function ThreeGlobe({ markets, activeMarket, onHover, onLeave, onSelect }: ThreeGlobeProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 3.24);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const globe = new THREE.Group();
    globe.rotation.y = INDIA_CENTER_ROTATION;
    globe.rotation.x = -0.20;
    scene.add(globe);

    const globeMaterial = new THREE.MeshBasicMaterial({ color: 0xc5def1 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), globeMaterial);
    globe.add(sphere);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.018, 64, 40),
      new THREE.MeshBasicMaterial({ color: 0xd9eaf8, transparent: true, opacity: 0.24, side: THREE.BackSide }),
    );
    globe.add(atmosphere);

    const markerObjects = new Map<string, THREE.Object3D>();
    for (const market of markets) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(latLngToVector(market.lat, market.lng, 1.028));
      globe.add(anchor);
      markerObjects.set(market.id, anchor);
    }

    // Myra uses the globe.gl interaction model, which is backed by
    // OrbitControls: left-drag rotates on both axes and the globe stays
    // upright. Keep zoom and pan off for this launchpad so the destination
    // labels and composer retain their designed relationship.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(globe.position);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.72;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    const handleControlStart = () => shell.classList.add("is-dragging");
    const handleControlEnd = () => shell.classList.remove("is-dragging");
    controls.addEventListener("start", handleControlStart);
    controls.addEventListener("end", handleControlEnd);

    let disposed = false;
    let texture: THREE.CanvasTexture | undefined;
    void createMapTexture().then((value) => {
      if (disposed) {
        value.dispose();
        return;
      }
      texture = value;
      globeMaterial.map = value;
      globeMaterial.color.set(0xffffff);
      globeMaterial.needsUpdate = true;
    });

    const resize = () => {
      const width = shell.clientWidth;
      const height = shell.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // The live Myra scene is a fixed square (1400 CSS px at desktop, drawn
      // at device-pixel resolution). A fixed camera is what keeps its sphere,
      // markers, and hover overlays registered as the viewport changes.
      camera.position.z = width <= 820 ? 3.5 : 3.24;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(shell);

    const worldPosition = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const globePosition = new THREE.Vector3();
    const surfaceNormal = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();
    let animationFrame = 0;
    const render = () => {
      controls.update();
      camera.getWorldPosition(cameraPosition);
      globe.getWorldPosition(globePosition);

      for (const market of markets) {
        const label = labelRefs.current.get(market.id);
        const anchor = markerObjects.get(market.id);
        if (!label || !anchor) continue;
        anchor.getWorldPosition(worldPosition);
        surfaceNormal.copy(worldPosition).sub(globePosition).normalize();
        cameraDirection.copy(cameraPosition).sub(globePosition).normalize();
        const visible = surfaceNormal.dot(cameraDirection) > 0.08;
        projected.copy(worldPosition).project(camera);
        label.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
        label.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
        label.style.opacity = visible ? "1" : "0";
        label.style.pointerEvents = visible ? "auto" : "none";
        label.style.transform = `translate(-50%, -50%) scale(${0.9 + Math.max(0, projected.z + 1) * 0.05})`;
      }

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.removeEventListener("start", handleControlStart);
      controls.removeEventListener("end", handleControlEnd);
      controls.dispose();
      texture?.dispose();
      sphere.geometry.dispose();
      globeMaterial.dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [markets]);

  return (
    <div ref={shellRef} className="three-globe-shell">
      <canvas ref={canvasRef} className="three-globe-canvas" aria-label="Interactive globe showing supported travel destinations" />
      <div className="globe-market-layer">
        {markets.map((market, index) => (
          <div
            key={market.id}
            ref={(node) => {
              if (node) labelRefs.current.set(market.id, node);
              else labelRefs.current.delete(market.id);
            }}
            className={activeMarket?.id === market.id ? "globe-market-anchor is-active" : "globe-market-anchor"}
            style={{ "--market-delay": `${index * 22}ms` } as CSSProperties}
            onPointerEnter={() => onHover(market)}
            onPointerLeave={onLeave}
          >
            <button
              type="button"
              className="globe-market-label"
              onFocus={() => onHover(market)}
              onBlur={onLeave}
              onClick={() => onSelect(market)}
              aria-label={`Use the ${market.name} trip idea`}
            >
              <i aria-hidden="true" />
              <span>{market.name}</span>
            </button>
            {activeMarket?.id === market.id ? (
              <span className="market-hover-card" aria-hidden="true">
                {market.imageUrl ? <NextImage src={market.imageUrl} alt="" width={420} height={210} /> : null}
                <span className="market-hover-card-copy">
                  <small>{market.country}</small>
                  <strong>{market.name}</strong>
                  <span>{market.tags.join(" · ")}</span>
                  <span className="market-hover-card-action">Use this trip idea <b aria-hidden="true">→</b></span>
                </span>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function latLngToVector(latitude: number, longitude: number, radius: number): THREE.Vector3 {
  // This is the same UV convention used by Three.js SphereGeometry: the
  // texture seam is at -180/180 and latitude 90 is the top of the texture.
  const theta = (90 - latitude) * Math.PI / 180;
  const phi = (longitude + MAP_LONGITUDE_REGISTRATION + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta) * radius,
    Math.cos(theta) * radius,
    Math.sin(phi) * Math.sin(theta) * radius,
  );
}

async function createMapTexture(): Promise<THREE.CanvasTexture> {
  const image = await loadImage("/world-map-equirectangular.png");
  const canvas = document.createElement("canvas");
  canvas.width = 2_048;
  canvas.height = 1_024;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas textures are unavailable");

  // The source is CC0 and has a narrow transparent frame. Cropping it keeps
  // the equirectangular land mask aligned with the sphere seam.
  context.drawImage(image, 46, 27, 1_163, 587, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance = (pixels.data[index]! + pixels.data[index + 1]! + pixels.data[index + 2]!) / 3;
    const isLand = pixels.data[index + 3]! > 20 && luminance < 238;
    // Match Myra's quiet globe treatment: pale blue water and white land.
    const color = isLand ? [240, 245, 249] : [197, 222, 241];
    pixels.data[index] = color[0];
    pixels.data[index + 1] = color[1];
    pixels.data[index + 2] = color[2];
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}
