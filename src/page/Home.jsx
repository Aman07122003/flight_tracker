import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import earth_map from '../assets/earth/earth_map.jpg';
import earth_bump from '../assets/earth/earth_bump.jpg';
import earth_specular from '../assets/earth/earth_specular.png';
import earth_clouds from '../assets/earth/earth_clouds.png';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const Home = () => {
  const mountRef = useRef(null);
  const earthRef = useRef(null);
  const markersGroupRef = useRef(null);
  const clockRef = useRef();
  const [selectedPlane, setSelectedPlane] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const cameraRef = useRef();
  const selectedPlaneRef = useRef(null);
  const animationFrameId = useRef();
  const modelCache = {};
  const sceneRef = useRef();

  useEffect(() => {
    selectedPlaneRef.current = selectedPlane;
  }, [selectedPlane]);

  const fetchFlights = async () => {
    try {
      const res = await fetch("https://opensky-network.org/api/states/all");
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch flight data');
      }
      const data = await res.json();
      return data.states?.filter(s => s[5] && s[6] && s[7] && s[1])?.map(s => ({
        icao24: s[0],
        callsign: s[1].trim(),
        latitude: s[6] || 0,
        longitude: s[5] || 0,
        altitude: s[7] || 0,
        velocity: s[9] || 0,
        heading: s[10] || 0,
        verticalRate: s[11] || 0,
        country: s[2] || 'Unknown'
      })) || [];
    } catch (err) {
      setError(err.message);
      return [];
    }
  };

  const loadModel = () => {
    return new Promise((resolve) => {
      if (modelCache['plane']) {
        return resolve(modelCache['plane'].clone());
      }

      const gltfLoader = new GLTFLoader();
      gltfLoader.load('/models/plane.glb', (gltf) => {
        modelCache['plane'] = gltf.scene;
        resolve(gltf.scene.clone());
      }, undefined, () => {
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(10, 5, 20),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        modelCache['plane'] = fallback;
        resolve(fallback.clone());
      });
    });
  };

  const createPlaneMarker = async (flight) => {
    const model = await loadModel();
    model.scale.setScalar(5);
    model.userData = { flight };

    model.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(0x0000ff);
        child.material.emissiveIntensity = 0;
      }
    });

    if (flight.heading != null) {
      model.rotation.y = -THREE.MathUtils.degToRad(flight.heading);
    }

    return model;
  };

  const updateMarkers = async (flights) => {
    if (!markersGroupRef.current) return;

    while (markersGroupRef.current.children.length > 0) {
      markersGroupRef.current.remove(markersGroupRef.current.children[0]);
    }

    for (const flight of flights) {
      if (
        flight.latitude < -90 || flight.latitude > 90 ||
        flight.longitude < -180 || flight.longitude > 180
      ) continue;

      const R = 200 + flight.altitude / 2000;
      const phi = (90 - flight.latitude) * (Math.PI / 180);
      const theta = (flight.longitude + 180) * (Math.PI / 180);

      const x = -R * Math.sin(phi) * Math.cos(theta);
      const y = R * Math.cos(phi);
      const z = R * Math.sin(phi) * Math.sin(theta);

      const marker = await createPlaneMarker(flight);
      marker.position.set(x, y, z);
      markersGroupRef.current.add(marker);
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      10000
    );
    camera.position.set(0, 0, 700);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(5, 5, 5);
    scene.add(light);

    const starsGeometry = new THREE.BufferGeometry();
    const starVertices = Array.from({ length: 10000 * 3 }, () =>
      THREE.MathUtils.randFloatSpread(2000)
    );
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starsGeometry,
      new THREE.PointsMaterial({ size: 0.7, opacity: 0.8, transparent: true }));
    scene.add(stars);

    const loader = new THREE.TextureLoader();
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(200, 64, 64),
      new THREE.MeshPhongMaterial({
        map: loader.load(earth_map),
        bumpMap: loader.load(earth_bump),
        bumpScale: 0.1,
        specularMap: loader.load(earth_specular),
        specular: new THREE.Color('grey'),
        shininess: 5
      })
    );

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(200.15, 64, 64),
      new THREE.MeshPhongMaterial({
        map: loader.load(earth_clouds),
        transparent: true,
        opacity: 0.6
      })
    );
    scene.add(clouds);
    scene.add(earth);
    earthRef.current = earth;

    const markersGroup = new THREE.Group();
    markersGroupRef.current = markersGroup;
    scene.add(markersGroup);

    const clock = new THREE.Clock();
    clockRef.current = clock;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        const marker = intersects[0].object;
        setSelectedPlane(prev =>
          prev?.icao24 === marker.userData?.flight?.icao24
            ? null
            : marker.userData?.flight || null
        );
      } else {
        setSelectedPlane(null);
      }
    };

    renderer.domElement.addEventListener('click', handleClick);

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      clouds.rotation.y += delta * 0.02;
      earth.rotation.y += delta * 0.01;

      markersGroup.children.forEach(marker => {
        if (marker.userData.flight.icao24 === selectedPlaneRef.current?.icao24) {
          marker.traverse(child => {
            if (child.isMesh) {
              child.material.emissiveIntensity = Math.sin(elapsed * 5) * 0.5 + 0.8;
            }
          });
        }
      });

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const initialize = async () => {
      try {
        const flights = await fetchFlights();
        await updateMarkers(flights);
        setIsLoading(false);
      } catch (err) {
        setError(err.message);
        setIsLoading(false);
      }
    };
    initialize();

    const interval = setInterval(async () => {
      try {
        const flights = await fetchFlights();
        await updateMarkers(flights);

        if (selectedPlaneRef.current) {
          const exists = flights.some(f =>
            f.icao24 === selectedPlaneRef.current.icao24
          );
          if (!exists) setSelectedPlane(null);
        }
      } catch (err) {
        setError(err.message);
      }
    }, 30000);

    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      }, 200);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      container.removeChild(renderer.domElement);
      cancelAnimationFrame(animationFrameId.current);
      renderer.dispose();
    };
  }, []);

  const handleZoom = (direction) => {
    if (cameraRef.current) {
      cameraRef.current.position.z += direction * 50;
      cameraRef.current.updateProjectionMatrix();
    }
  };

  return (
    <div className="relative h-screen w-full bg-gray-900">
      <div ref={mountRef} className="absolute inset-0" />

      {selectedPlane && (
        <div className="absolute top-4 right-4 bg-gray-800/90 backdrop-blur-sm p-6 rounded-xl w-80 z-10
          border border-gray-700 shadow-2xl animate-fade-in-up">
          <h2 className="text-xl font-semibold text-white mb-2">Flight Info</h2>
          <p className="text-sm text-gray-300">Callsign: {selectedPlane.callsign}</p>
          <p className="text-sm text-gray-300">ICAO24: {selectedPlane.icao24}</p>
          <p className="text-sm text-gray-300">Altitude: {selectedPlane.altitude} m</p>
          <p className="text-sm text-gray-300">Velocity: {selectedPlane.velocity} m/s</p>
          <p className="text-sm text-gray-300">Heading: {selectedPlane.heading}°</p>
          <p className="text-sm text-gray-300">Country: {selectedPlane.country}</p>
        </div>
      )}

      <div className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-sm p-4 rounded-xl z-10
        border border-gray-700 text-white">
        {isLoading ? 'Loading flights...' : error ? `Error: ${error}` : 'Live flights updated'}
      </div>

      <div className="fixed flex flex-col top-10/12 right-4 transform -translate-y-1/2 space-y-2 z-50">
        <button
          onClick={() => handleZoom(-1)}
          className="bg-gray-600 hover:bg-gray-500 text-white p-7 rounded-full shadow-lg"
          aria-label="Zoom In"
        >
          +
        </button>
        <button
          onClick={() => handleZoom(1)}
          className="bg-gray-600 hover:bg-gray-500 text-white p-7 rounded-full shadow-lg"
          aria-label="Zoom Out"
        >
          −
        </button>
      </div>
    </div>
  );
};

export default Home;
