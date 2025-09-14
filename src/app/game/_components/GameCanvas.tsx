"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "~/trpc/react";

type Vec = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

type EntityBase = Rect & { vx: number; vy: number };

type Player = EntityBase & { type: "player"; speed: number };
type Bullet = EntityBase & { type: "bullet"; speed: number };
type Obstacle = EntityBase & { type: "obstacle" };
type PowerUp = EntityBase & { type: "powerup" };

type GameState =
  | { status: "init" }
  | { status: "running"; startedAt: number }
  | { status: "over"; win: boolean; durationMs: number };

const CANVAS_W = 800;
const CANVAS_H = 1000;

const PLAYER_SIZE: Vec = { x: 40, y: 40 };
const BULLET_SIZE: Vec = { x: 6, y: 14 };
const OBSTACLE_SIZE: Vec = { x: 46, y: 46 };
const POWER_SIZE: Vec = { x: 28, y: 28 };

const SCROLL_SPEED = 160; // px/s (world moves downward visually)
const PLAYER_BASE_SPEED = 320; // px/s
const BULLET_SPEED = 640; // px/s upward
const OBSTACLE_SPEED = 140; // px/s downward (relative)
const SPAWN_RATE_OBS = 1.2; // per second
const SPAWN_RATE_PWR = 0.35; // per second
const FIRE_RATE_MS = 140; // min ms between shots
const GOAL_DISTANCE = 6000; // reach to clear (worldY)

const tryLoadImage = (src: string) => {
  if (typeof window === 'undefined') {
    return { complete: false, naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
  }
  const img = new Image();
  img.src = src;
  return img;
};

// Prefer PNG; .jpg/.jpeg kept as secondary fallbacks
const bgCandidates = ["/maps/map1.png", "/maps/map1.jpg", "/maps/map1.jpeg"];

const GRID_SIZE = 8;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const CAMERA_SPEED = 0.15; // Speed of camera movement (0-1 per second)

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastShotRef = useRef<number>(0);

  const [state, setState] = useState<GameState>({ status: "init" });
  // Start viewing from the bottom of the background image so it feels like "climbing up".
  const [worldY, setWorldY] = useState(CANVAS_H);
  const [score, setScore] = useState(0);
  const [powerLevel, setPowerLevel] = useState(1);
  const submittedRef = useRef(false);

  // Tile system state
  const [currentTileIndex, setCurrentTileIndex] = useState(0);
  const tilesRef = useRef<HTMLImageElement[]>([]);
  const tileStartTimeRef = useRef<number>(0);
  // Track destroyed obstacles and collected items per tile
  const destroyedObstaclesRef = useRef<Set<string>>(new Set());
  const collectedItemsRef = useRef<Set<string>>(new Set());
  
  // Power-up timer system
  const [powerUpEndTime, setPowerUpEndTime] = useState<number>(0);
  const POWER_UP_DURATION = 10000; // 10 seconds in milliseconds
  
  // Boss (Chimera) system
  const chimeraRef = useRef<HTMLImageElement>();
  const [chimeraSize, setChimeraSize] = useState<number>(32); // Start small (32x32)
  const [chimeraHits, setChimeraHits] = useState<number>(0);
  const [chimeraPos, setChimeraPos] = useState({ x: CANVAS_W / 2, y: 50 });
  const [chimeraVel, setChimeraVel] = useState({ x: 150, y: 100 });
  const [chimeraFrameTime, setChimeraFrameTime] = useState<number>(0);
  const CHIMERA_INITIAL_SIZE = 32;
  const CHIMERA_GROWTH_RATE = 4; // Pixels to grow per hit
  const CHIMERA_MAX_SIZE = 999999; // Allow unlimited growth
  const GIF_FRAME_DURATION = 100; // Milliseconds per frame to force redraw
  const [slideOffset, setSlideOffset] = useState({ x: 0, y: 0 });
  const slideAnimationRef = useRef<{ startTime: number; fromOffset: { x: number; y: number }; toOffset: { x: number; y: number } } | null>(null);

  const recordRun = api.game.recordRun.useMutation();
  const { data: serverKeymap } = api.keymap.get.useQuery();

  const playerRef = useRef<Player>({
    type: "player",
    x: CANVAS_W / 2 - PLAYER_SIZE.x / 2,
    y: CANVAS_H - 120,
    w: PLAYER_SIZE.x,
    h: PLAYER_SIZE.y,
    vx: 0,
    vy: 0,
    speed: PLAYER_BASE_SPEED,
  });

  const bulletsRef = useRef<Bullet[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const powersRef = useRef<PowerUp[]>([]);

  const bgImg = useMemo(() => {
    const candidate = bgCandidates.find((s) => !!s) ?? "/maps/map1.png";
    return tryLoadImage(candidate);
  }, []);

  // Load all tile images
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const tiles: HTMLImageElement[] = [];
    for (let i = 0; i < TOTAL_TILES; i++) {
      const tileIndex = String(i).padStart(2, '0');
      const img = new Image();
      img.src = `/maps/tiles/tile_${tileIndex}.png`;
      tiles.push(img);
    }
    tilesRef.current = tiles;
  }, []);

  // Load Chimera image with proper GIF handling
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const chimeraImg = new Image();
    chimeraImg.onload = () => {
      console.log('Chimera image loaded successfully', chimeraImg.width, chimeraImg.height);
    };
    chimeraImg.onerror = (e) => {
      console.error('Failed to load Chimera image:', e);
    };
    // Add cache busting and force reload for GIF animation
    chimeraImg.src = '/enemy.gif?' + Math.random();
    chimeraRef.current = chimeraImg;
    console.log('Chimera image loading started:', chimeraImg.src);
  }, []);

  // Get boustrophedon position for tile index
  const getTilePosition = (index: number) => {
    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;
    const isEvenRow = row % 2 === 0;
    const actualCol = isEvenRow ? col : (GRID_SIZE - 1 - col);
    return { row, col: actualCol };
  };

  // Easing function for smooth transitions
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // Get slide direction between two tiles
  const getSlideDirection = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return { x: 0, y: 0 };

    const fromPos = getTilePosition(fromIndex);
    const toPos = getTilePosition(toIndex);

    // Determine primary direction
    if (fromPos.row !== toPos.row) {
      // Row change - vertical movement
      return fromPos.row < toPos.row ? { x: 0, y: -1 } : { x: 0, y: 1 };
    } else {
      // Same row - horizontal movement
      return fromPos.col < toPos.col ? { x: -1, y: 0 } : { x: 1, y: 0 };
    }
  };

  // --- Route & camera setup (serpentine) ---
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [goalDistance, setGoalDistance] = useState<number>(GOAL_DISTANCE);
  const routeRef = useRef<{
    points: Vec[];
    cum: number[];
    length: number;
  } | null>(null);

  // Wait image natural size
  useEffect(() => {
    const update = (_e: Event) => {
      if (bgImg.naturalWidth > 0 && bgImg.naturalHeight > 0) {
        setImgSize({ w: bgImg.naturalWidth, h: bgImg.naturalHeight });
      }
    };
    if (bgImg.complete) update(new Event("load"));
    else bgImg.addEventListener("load", update, { once: true });
    return () => bgImg.removeEventListener("load", update);
  }, [bgImg]);

  // tRPC: request serpentine route once image size is known
  const { data: serverRoute } = api.map.computeRoute.useQuery(
    imgSize
      ? { imgW: imgSize.w, imgH: imgSize.h, rows: 6, cols: 8, margin: 40 }
      : { imgW: 1, imgH: 1, rows: 1, cols: 1, margin: 0 },
    { enabled: !!imgSize },
  );

  useEffect(() => {
    if (!serverRoute) return;
    const pts: Vec[] = serverRoute.points as Vec[];
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i - 1]!;
      total += Math.hypot(a.x - b.x, a.y - b.y);
      cum.push(total);
    }
    routeRef.current = { points: pts, cum, length: serverRoute.length };
    setGoalDistance(Math.max(1, Math.round(serverRoute.length)));
  }, [serverRoute]);

  const getPointAt = useCallback((dist: number): Vec | null => {
    const r = routeRef.current;
    if (!r) return null;
    const d = Math.max(0, Math.min(r.length, dist));
    let lo = 0,
      hi = r.cum.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (r.cum[mid]! < d) lo = mid + 1;
      else hi = mid;
    }
    const idx = Math.max(1, lo);
    const d1 = r.cum[idx - 1]!;
    const d2 = r.cum[idx]!;
    const p1 = r.points[idx - 1]!;
    const p2 = r.points[idx]!;
    const t = d2 === d1 ? 0 : (d - d1) / (d2 - d1);
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  }, []);

  const aabb = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const reset = useCallback(() => {
    setState({ status: "init" });
    // Reset to show the bottom of the image again at restart
    setWorldY(CANVAS_H);
    setScore(0);
    setPowerLevel(1);
    setCurrentTileIndex(0);
    setSlideOffset({ x: 0, y: 0 });
    tileStartTimeRef.current = null;
    // Reset power-up timer
    setPowerUpEndTime(0);
    // Reset Chimera boss
    setChimeraSize(CHIMERA_INITIAL_SIZE);
    setChimeraHits(0);
    setChimeraPos({ x: CANVAS_W / 2, y: 50 });
    setChimeraVel({ x: 150, y: 100 });
    setChimeraFrameTime(0);
    // Clear input state to avoid stuck keys between runs
    keysRef.current = {};
    playerRef.current = {
      type: "player",
      x: CANVAS_W / 2 - PLAYER_SIZE.x / 2,
      y: CANVAS_H - 120,
      w: PLAYER_SIZE.x,
      h: PLAYER_SIZE.y,
      vx: 0,
      vy: 0,
      speed: PLAYER_BASE_SPEED,
    };
    bulletsRef.current = [];
    obstaclesRef.current = [];
    powersRef.current = [];
    // Clear destroyed/collected item records
    destroyedObstaclesRef.current.clear();
    collectedItemsRef.current.clear();
  }, []);

  const DEFAULT_CODE_KEYMAP = useMemo(
    () => ({
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      shoot: ["Space"],
    }),
    [],
  );

  const codeSets = useMemo(() => {
    const map = serverKeymap ?? DEFAULT_CODE_KEYMAP;
    return {
      up: new Set<string>(map.up as string[]),
      down: new Set<string>(map.down as string[]),
      left: new Set<string>(map.left as string[]),
      right: new Set<string>(map.right as string[]),
      shoot: new Set<string>(map.shoot as string[]),
    } as const;
  }, [serverKeymap, DEFAULT_CODE_KEYMAP]);

  // Input
  useEffect(() => {
    const mapCodeToKey = (e: KeyboardEvent): string | null => {
      const c = e.code;
      if (codeSets.up.has(c)) return "w";
      if (codeSets.left.has(c)) return "a";
      if (codeSets.down.has(c)) return "s";
      if (codeSets.right.has(c)) return "d";
      if (codeSets.shoot.has(c)) return "space";
      return null;
    };

    const normalizeKey = (e: KeyboardEvent): string => {
      const mapped = mapCodeToKey(e);
      if (mapped) return mapped;
      const k = e.key;
      if (
        k === " " ||
        k.toLowerCase() === "space" ||
        k.toLowerCase() === "spacebar"
      )
        return "space";
      return k.toLowerCase();
    };

    const setKey = (key: string, pressed: boolean) => {
      // Only track known keys
      if (
        key === "w" ||
        key === "a" ||
        key === "s" ||
        key === "d" ||
        key === "space"
      ) {
        keysRef.current[key] = pressed;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier combos like Cmd/Ctrl/Alt
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = normalizeKey(e);
      if (key === "space" || key === "w" || key === "s") e.preventDefault();
      setKey(key, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = normalizeKey(e);
      setKey(key, false);
    };

    const clearKeys = () => {
      keysRef.current = {};
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearKeys();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [codeSets]);

  const fire = useCallback(
    (now: number) => {
      if (now - lastShotRef.current < FIRE_RATE_MS) return;
      lastShotRef.current = now;
      const p = playerRef.current;

      const spread = Math.min(powerLevel - 1, 3); // up to 3 side bullets
      const bullets: Bullet[] = [];
      for (let i = -spread; i <= spread; i++) {
        const offsetX = i * 10;
        bullets.push({
          type: "bullet",
          x: p.x + p.w / 2 - BULLET_SIZE.x / 2 + offsetX,
          y: p.y - BULLET_SIZE.y,
          w: BULLET_SIZE.x,
          h: BULLET_SIZE.y,
          vx: 0,
          vy: -BULLET_SPEED,
          speed: BULLET_SPEED,
        });
      }
      bulletsRef.current.push(...bullets);
    },
    [powerLevel],
  );

  // Spawn helpers
  const spawnObstacle = (y: number) => {
    const x = Math.random() * (CANVAS_W - OBSTACLE_SIZE.x);
    obstaclesRef.current.push({
      type: "obstacle",
      x,
      y,
      w: OBSTACLE_SIZE.x,
      h: OBSTACLE_SIZE.y,
      vx: 0,
      vy: OBSTACLE_SPEED,
    });
  };
  const spawnPower = (y: number) => {
    const x = Math.random() * (CANVAS_W - POWER_SIZE.x);
    powersRef.current.push({
      type: "powerup",
      x,
      y,
      w: POWER_SIZE.x,
      h: POWER_SIZE.y,
      vx: 0,
      vy: OBSTACLE_SPEED * 0.8,
    });
  };

  const step = useCallback(
    (ts: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;

      const dt = Math.min(50, ts - (lastTsRef.current || ts)) / 1000; // clamp 50ms
      lastTsRef.current = ts;

      // Update world scroll
      const advance = SCROLL_SPEED * dt;
      setWorldY((y) => y + advance);

      // Check if power-up has expired
      if (powerUpEndTime > 0 && ts >= powerUpEndTime) {
        setPowerLevel(1); // Reset to base power level
        setPowerUpEndTime(0);
      }

      // Player movement
      const p = playerRef.current;
      let ax = 0,
        ay = 0;
      const k = keysRef.current as Record<
        "w" | "a" | "s" | "d" | "space",
        boolean
      >;
      if (k.w) ay -= 1;
      if (k.s) ay += 1;
      if (k.a) ax -= 1;
      if (k.d) ax += 1;
      const len = Math.hypot(ax, ay) || 1;
      const spd = p.speed;
      p.vx = (ax / len) * spd;
      p.vy = (ay / len) * spd + SCROLL_SPEED * 0.1; // slight push upward
      p.x = Math.max(0, Math.min(CANVAS_W - p.w, p.x + p.vx * dt));
      p.y = Math.max(0, Math.min(CANVAS_H - p.h, p.y + p.vy * dt));

      // Shooting
      if (k.space) fire(ts);

      // Calculate camera offset and current tile info
      let cameraOffsetX = 0;
      let cameraOffsetY = 0;
      let currentTileIdx = 0;
      let visibleTiles = [];
      
      if (tilesRef.current.length > 0 && state.status === "running") {
        // Initialize start time if not set
        if (!tileStartTimeRef.current) {
          tileStartTimeRef.current = ts;
        }
        
        const elapsedTime = (ts - tileStartTimeRef.current) / 1000;
        const totalProgress = elapsedTime * CAMERA_SPEED;
        const pathPosition = totalProgress % TOTAL_TILES;
        const currentTileFloat = pathPosition;
        currentTileIdx = Math.floor(currentTileFloat);
        const nextTileIdx = (currentTileIdx + 1) % TOTAL_TILES;
        const progress = currentTileFloat - currentTileIdx;
        
        // Update displayed tile index
        if (currentTileIdx !== currentTileIndex) {
          setCurrentTileIndex(currentTileIdx);
        }
        
        // Get tile positions in the grid
        const currentPos = getTilePosition(currentTileIdx);
        const nextPos = getTilePosition(nextTileIdx);
        
        // Calculate camera offset
        if (currentPos.row === nextPos.row) {
          // Horizontal movement within the same row
          const direction = currentPos.row % 2 === 0 ? 1 : -1;
          cameraOffsetX = -direction * CANVAS_W * progress;
        } else {
          // Vertical movement to next row
          cameraOffsetY = -CANVAS_H * progress;
        }
        
        // Determine visible tiles (current and potentially next)
        visibleTiles = [currentTileIdx];
        if (progress > 0.1) { // Only show next tile when transition is significant
          visibleTiles.push(nextTileIdx);
        }
      }

      // Generate tile-based static obstacles and power-ups
      obstaclesRef.current = [];
      powersRef.current = [];
      
      visibleTiles.forEach((tileIdx) => {
        // Generate deterministic obstacles for each tile
        const tileRandom = new (class {
          seed: number;
          constructor(seed: number) {
            this.seed = seed;
          }
          next() {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
          }
        })(tileIdx * 1000); // Use tile index as seed
        
        // Generate 2-4 obstacles per tile
        const obstacleCount = Math.floor(tileRandom.next() * 3) + 2;
        
        for (let i = 0; i < obstacleCount; i++) {
          const obstacleId = `${tileIdx}-obs-${i}`;
          
          // Always consume the random numbers to keep sequence consistent
          const x = tileRandom.next() * (CANVAS_W - OBSTACLE_SIZE.x);
          const y = tileRandom.next() * (CANVAS_H - OBSTACLE_SIZE.y);
          
          // Skip if this obstacle has been destroyed, but keep random sequence consistent
          if (destroyedObstaclesRef.current.has(obstacleId)) {
            continue;
          }
          
          // Apply camera offset to position obstacles correctly
          let adjustedX = x;
          let adjustedY = y;
          
          if (tileIdx !== currentTileIdx) {
            // This is the next tile, apply transition offset
            const currentPos = getTilePosition(currentTileIdx);
            const nextPos = getTilePosition(tileIdx);
            
            if (currentPos.row === nextPos.row) {
              // Same row - horizontal offset
              const direction = currentPos.row % 2 === 0 ? 1 : -1;
              adjustedX = x + direction * CANVAS_W;
            } else {
              // Next row - vertical offset
              adjustedY = y + CANVAS_H;
            }
          }
          
          // Apply camera offset
          adjustedX += cameraOffsetX;
          adjustedY += cameraOffsetY;
          
          obstaclesRef.current.push({
            type: "obstacle",
            id: obstacleId,
            x: adjustedX,
            y: adjustedY,
            w: OBSTACLE_SIZE.x,
            h: OBSTACLE_SIZE.y,
            vx: 0,
            vy: 0, // Static obstacles
          });
        }
        
        // Generate 1-2 power-ups per tile
        const powerCount = Math.floor(tileRandom.next() * 2) + 1;
        
        for (let i = 0; i < powerCount; i++) {
          const itemId = `${tileIdx}-pwr-${i}`;
          
          // Always consume the random numbers to keep sequence consistent
          const x = tileRandom.next() * (CANVAS_W - POWER_SIZE.x);
          const y = tileRandom.next() * (CANVAS_H - POWER_SIZE.y);
          
          // Skip if this item has been collected, but keep random sequence consistent
          if (collectedItemsRef.current.has(itemId)) {
            continue;
          }
          
          // Apply camera offset to position power-ups correctly
          let adjustedX = x;
          let adjustedY = y;
          
          if (tileIdx !== currentTileIdx) {
            // This is the next tile, apply transition offset
            const currentPos = getTilePosition(currentTileIdx);
            const nextPos = getTilePosition(tileIdx);
            
            if (currentPos.row === nextPos.row) {
              // Same row - horizontal offset
              const direction = currentPos.row % 2 === 0 ? 1 : -1;
              adjustedX = x + direction * CANVAS_W;
            } else {
              // Next row - vertical offset
              adjustedY = y + CANVAS_H;
            }
          }
          
          // Apply camera offset
          adjustedX += cameraOffsetX;
          adjustedY += cameraOffsetY;
          
          powersRef.current.push({
            type: "powerup",
            id: itemId,
            x: adjustedX,
            y: adjustedY,
            w: POWER_SIZE.x,
            h: POWER_SIZE.y,
            vx: 0,
            vy: 0, // Static power-ups
          });
        }
      });

      // Update bullets (not affected by camera movement)
      bulletsRef.current.forEach((b) => (b.y += b.vy * dt));
      bulletsRef.current = bulletsRef.current.filter((b) => b.y + b.h > -40);

      // Collisions: bullets vs obstacles
      for (const b of bulletsRef.current) {
        for (const o of obstaclesRef.current) {
          if (aabb(b, o)) {
            // Mark obstacle as destroyed
            if (o.id) {
              destroyedObstaclesRef.current.add(o.id);
            }
            // Mark bullet for removal
            b.y = -100;
            setScore((s) => s + 10);
          }
        }
      }

      // Update Chimera position with better boundary detection
      let newChimeraX = chimeraPos.x + chimeraVel.x * dt;
      let newChimeraY = chimeraPos.y + chimeraVel.y * dt;
      let newVelX = chimeraVel.x;
      let newVelY = chimeraVel.y;

      // Check boundaries and bounce
      if (newChimeraX <= 0) {
        newChimeraX = 0;
        newVelX = Math.abs(newVelX);
      } else if (newChimeraX >= CANVAS_W - chimeraSize) {
        newChimeraX = CANVAS_W - chimeraSize;
        newVelX = -Math.abs(newVelX);
      }

      if (newChimeraY <= 0) {
        newChimeraY = 0;
        newVelY = Math.abs(newVelY);
      } else if (newChimeraY >= CANVAS_H - chimeraSize) {
        newChimeraY = CANVAS_H - chimeraSize;
        newVelY = -Math.abs(newVelY);
      }

      setChimeraPos({ x: newChimeraX, y: newChimeraY });
      setChimeraVel({ x: newVelX, y: newVelY });

      // Update GIF frame time to force redraw
      setChimeraFrameTime((prev) => prev + dt * 1000);

      // Collisions: bullets vs Chimera boss
      const chimera = {
        x: chimeraPos.x,
        y: chimeraPos.y,
        w: chimeraSize,
        h: chimeraSize
      };

      for (const b of bulletsRef.current) {
        if (aabb(b, chimera)) {
          // Mark bullet for removal
          b.y = -100;
          // Grow Chimera when hit (unlimited growth)
          setChimeraSize((size) => size + CHIMERA_GROWTH_RATE);
          setChimeraHits((hits) => hits + 1);
          setScore((s) => s + 20); // More points for hitting boss
        }
      }

      bulletsRef.current = bulletsRef.current.filter((b) => b.y > -50);

      // Collisions: player vs obstacle
      const visibleObstacles = obstaclesRef.current.filter(
        (o) => o.x >= -o.w && o.x <= CANVAS_W && o.y >= -o.h && o.y <= CANVAS_H
      );
      
      if (visibleObstacles.some((o) => aabb(p, o))) {
        const startedAt =
          (state.status === "running" ? state.startedAt : ts) || ts;
        const durationMs = Math.max(0, ts - startedAt);
        setState({ status: "over", win: false, durationMs });
      }

      // Collisions: player vs power-up
      const visiblePowers = powersRef.current.filter(
        (pw) => pw.x >= -pw.w && pw.x <= CANVAS_W && pw.y >= -pw.h && pw.y <= CANVAS_H
      );
      
      for (const pw of visiblePowers) {
        if (aabb(p, pw)) {
          // Mark item as collected
          if (pw.id) {
            collectedItemsRef.current.add(pw.id);
          }
          // Activate timed power-up
          setPowerLevel((lv) => Math.min(5, lv + 1));
          setPowerUpEndTime(ts + POWER_UP_DURATION);
          setScore((s) => s + 5);
        }
      }

      // Collisions: player vs Chimera (game over)
      if (state.status === "running") {
        const chimeraCollisionBox = {
          x: chimeraPos.x,
          y: chimeraPos.y,
          w: chimeraSize,
          h: chimeraSize
        };

        if (aabb(p, chimeraCollisionBox)) {
          const startedAt =
            (state.status === "running" ? state.startedAt : ts) || ts;
          const durationMs = Math.max(0, ts - startedAt);
          setState({ status: "over", win: false, durationMs });
        }
      }

      // Win condition (distance along path or fallback)
      if (worldY + advance >= goalDistance) {
        const startedAt =
          (state.status === "running" ? state.startedAt : ts) || ts;
        const durationMs = Math.max(0, ts - startedAt);
        setState({ status: "over", win: true, durationMs });
      }

      // Draw
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Continuous smooth camera panning through tiles
      if (tilesRef.current.length > 0 && state.status === "running") {
        // Draw current tile
        const currentTile = tilesRef.current[currentTileIdx];
        if (currentTile && currentTile.complete) {
          ctx.drawImage(
            currentTile,
            0, 0, currentTile.naturalWidth, currentTile.naturalHeight,
            cameraOffsetX, cameraOffsetY, CANVAS_W, CANVAS_H
          );
        }
        
        // Draw next tile for seamless transition
        const elapsedTime = (ts - tileStartTimeRef.current) / 1000;
        const totalProgress = elapsedTime * CAMERA_SPEED;
        const pathPosition = totalProgress % TOTAL_TILES;
        const currentTileFloat = pathPosition;
        const nextTileIdx = (Math.floor(currentTileFloat) + 1) % TOTAL_TILES;
        const progress = currentTileFloat - Math.floor(currentTileFloat);
        
        const nextTile = tilesRef.current[nextTileIdx];
        if (nextTile && nextTile.complete && progress > 0) {
          const currentPos = getTilePosition(currentTileIdx);
          const nextPos = getTilePosition(nextTileIdx);
          
          let nextX = cameraOffsetX;
          let nextY = cameraOffsetY;
          
          if (currentPos.row === nextPos.row) {
            // Same row - position next tile horizontally
            const direction = currentPos.row % 2 === 0 ? 1 : -1;
            nextX = cameraOffsetX + direction * CANVAS_W;
          } else {
            // Next row - position next tile vertically
            nextY = cameraOffsetY + CANVAS_H;
          }
          
          ctx.drawImage(
            nextTile,
            0, 0, nextTile.naturalWidth, nextTile.naturalHeight,
            nextX, nextY, CANVAS_W, CANVAS_H
          );
        }
      } else if (bgImg.complete && bgImg.naturalWidth > 0 && routeRef.current) {
        // Choose a viewport smaller than the image to allow panning in both axes.
        const viewportFrac = 0.45; // portion of the image width used for the viewport
        const srcW = Math.max(
          64,
          Math.min(
            bgImg.naturalWidth,
            Math.floor(bgImg.naturalWidth * viewportFrac),
          ),
        );
        const srcH = Math.max(
          64,
          Math.min(
            bgImg.naturalHeight,
            Math.floor((srcW * CANVAS_H) / CANVAS_W),
          ),
        );
        const cam = getPointAt(worldY) ?? {
          x: bgImg.naturalWidth / 2,
          y: bgImg.naturalHeight / 2,
        };
        const sx = Math.max(
          0,
          Math.min(bgImg.naturalWidth - srcW, cam.x - srcW / 2),
        );
        const sy = Math.max(
          0,
          Math.min(bgImg.naturalHeight - srcH, cam.y - srcH / 2),
        );
        ctx.drawImage(bgImg, sx, sy, srcW, srcH, 0, 0, CANVAS_W, CANVAS_H);
      } else if (bgImg.complete && bgImg.naturalWidth > 0) {
        // tile vertically using worldY as offset
        const imgH = (CANVAS_W / bgImg.naturalWidth) * bgImg.naturalHeight;
        const offset = (worldY % imgH) - imgH;
        for (let y = offset; y < CANVAS_H; y += imgH) {
          ctx.drawImage(
            bgImg,
            0,
            0,
            bgImg.naturalWidth,
            bgImg.naturalHeight,
            0,
            Math.floor(y),
            CANVAS_W,
            Math.floor(imgH),
          );
        }
      } else {
        const grd = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
        grd.addColorStop(0, "#082032");
        grd.addColorStop(1, "#2C394B");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }

      // Draw entities
      // Player
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(p.x, p.y, p.w, p.h);

      // Bullets
      ctx.fillStyle = "#93c5fd";
      bulletsRef.current.forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));

      // Obstacles (only draw visible ones)
      ctx.fillStyle = "#f87171";
      obstaclesRef.current.forEach((o) => {
        if (o.x >= -o.w && o.x <= CANVAS_W && o.y >= -o.h && o.y <= CANVAS_H) {
          ctx.fillRect(o.x, o.y, o.w, o.h);
        }
      });

      // Power-ups (only draw visible ones)
      ctx.fillStyle = "#fbbf24";
      powersRef.current.forEach((pw) => {
        if (pw.x >= -pw.w && pw.x <= CANVAS_W && pw.y >= -pw.h && pw.y <= CANVAS_H) {
          ctx.fillRect(pw.x, pw.y, pw.w, pw.h);
        }
      });

      // Draw Chimera boss (always visible on screen) - Simplified for better GIF animation
      if (chimeraRef.current && state.status === "running") {
        if (chimeraRef.current.complete && chimeraRef.current.naturalWidth > 0) {
          // Simple direct draw - let browser handle GIF animation
          ctx.drawImage(
            chimeraRef.current,
            chimeraPos.x,
            chimeraPos.y,
            chimeraSize,
            chimeraSize
          );
        } else {
          // Show placeholder while loading
          ctx.fillStyle = "#ff00ff";
          ctx.fillRect(chimeraPos.x, chimeraPos.y, chimeraSize, chimeraSize);
          ctx.fillStyle = "#ffffff";
          ctx.font = "12px monospace";
          ctx.fillText("Loading...", chimeraPos.x, chimeraPos.y + 15);
        }
      }

      // HUD
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px monospace";
      
      // Calculate power-up timer
      const powerUpTimeLeft = powerUpEndTime > 0 ? Math.max(0, Math.ceil((powerUpEndTime - ts) / 1000)) : 0;
      const powerUpDisplay = powerUpTimeLeft > 0 ? `  Power: ${powerUpTimeLeft}s` : "";

      if (state.status === "running" && tilesRef.current.length > 0) {
        ctx.fillText(
          `Score: ${score}  Power: ${powerLevel}${powerUpDisplay}  Tile: ${currentTileIndex + 1}/${TOTAL_TILES}`,
          12,
          22,
        );
        // Second line for Chimera info
        ctx.fillText(
          `Chimera Hits: ${chimeraHits}  Size: ${chimeraSize}px`,
          12,
          42,
        );
      } else {
        ctx.fillText(
          `Score: ${score}  Power: ${powerLevel}${powerUpDisplay}  Dist: ${Math.floor(worldY)}/${goalDistance}`,
          12,
          22,
        );
      }

      // Continue loop if still running
      if (state.status === "running") {
        rafRef.current = requestAnimationFrame(step);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fire, score, powerLevel, worldY, state.status, goalDistance, getPointAt, powerUpEndTime, chimeraSize, chimeraHits, chimeraPos, chimeraVel, chimeraFrameTime],
  );

  // Game loop control
  useEffect(() => {
    if (state.status === "running") {
      lastTsRef.current = performance.now();
      rafRef.current = requestAnimationFrame(step);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }
  }, [state.status, step]);

  // Persist result once on finish via tRPC
  useEffect(() => {
    if (state.status !== "over" || submittedRef.current) return;
    submittedRef.current = true;
    recordRun.mutate({
      status: state.win ? "WIN" : "LOSE",
      durationMs: Math.round(state.durationMs),
      score,
    });
  }, [state, recordRun, score]);

  const start = () => {
    // Ensure clean input state when starting
    keysRef.current = {};
    const now = performance.now();
    setState({ status: "running", startedAt: now });
    submittedRef.current = false;
    setCurrentTileIndex(0);
    tileStartTimeRef.current = now;
    setSlideOffset({ x: 0, y: 0 });
    slideAnimationRef.current = null;
  };

  const overlay = () => {
    if (state.status === "init")
      return (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          <div className="rounded-lg bg-zinc-900/80 p-6 text-center">
            <p className="mb-4">WASD or Arrow Keys: Move / Space: Shoot</p>
            <p className="mb-4">Reach the goal without hitting obstacles.</p>
            <button
              className="rounded bg-emerald-500 px-4 py-2 hover:bg-emerald-600"
              onClick={start}
            >
              Game Start
            </button>
          </div>
        </div>
      );
    if (state.status === "over")
      return (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          <div className="rounded-lg bg-zinc-900/80 p-6 text-center">
            <p className="mb-2 text-xl font-bold">
              {state.win ? "Game Clear!" : "Game Over"}
            </p>
            <p className="mb-4">
              Time: {(state.durationMs / 1000).toFixed(2)}s | Score: {score}
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="rounded bg-emerald-500 px-4 py-2 hover:bg-emerald-600"
                onClick={reset}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    return null;
  };

  return (
    <div className="relative grid h-[100svh] w-[100vw] place-items-center overflow-hidden">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="block aspect-[4/5] w-[min(100vw,calc(100svh*0.8))] touch-none bg-black select-none"
      />
      {overlay()}
      <p className="mt-3 text-sm text-zinc-300">
        背景画像は <code>/public/maps/map1.jpg</code> または{" "}
        <code>map1.png</code> を配置すると反映されます。
      </p>
    </div>
  );
}
