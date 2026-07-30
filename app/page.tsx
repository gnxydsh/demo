'use client';

import { useCallback, useRef, useState, type CSSProperties } from "react";
import InfiniteMenu from "@/components/InfiniteMenu";
import Galaxy from "@/components/Galaxy";
import MagneticDiscovery from "@/components/MagneticDiscovery";
import styles from "./page.module.css";

const items = [
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
    audio: "/m/justin-bieber-changes.mp3",
    lrc: "/lrc/changes-justin-bieber.lrc",
  },
  {
    image: "/p/attention.jpg",
    title: "Attention",
    artist: "NewJeans",
    audio: "/m/attention-newjeans.mp3",
    lrc: "/lrc/attention-newjeans.lrc",
  },
  {
    image: "/p/ditto.jpg",
    title: "Ditto",
    artist: "NewJeans",
    audio: "/m/ditto-newjeans.mp3",
    lrc: "/lrc/ditto-newjeans.lrc",
  },
  {
    image: "/p/magnetic.jpg",
    title: "Magnetic",
    artist: "ILLIT",
    audio: "/m/illit-magnetic.mp3",
    lrc: "/lrc/magnetic-illit.lrc",
  },
  {
    image: "/p/christmas-star.jpg",
    title: "圣诞星",
    artist: "周杰伦 (feat. 杨瑞代)",
    audio: "/m/christmas-star.mp3",
    lrc: "/lrc/christmas-star.lrc",
  },
];

type PlaybackDetail = {
  currentTime: number;
  duration: number;
  progress: number;
  title: string;
  artist: string;
  lyric: string;
};

const EMPTY_PLAYBACK_DETAIL: PlaybackDetail = {
  currentTime: 0,
  duration: 0,
  progress: 0,
  title: '',
  artist: '',
  lyric: '',
};

export default function Home() {
  const sceneRef = useRef<HTMLElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hue, setHue] = useState(140);
  const [isMoving, setIsMoving] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [playbackDetail, setPlaybackDetail] = useState(
    EMPTY_PLAYBACK_DETAIL,
  );
  const handleProgressChange = useCallback((progress: number) => {
    sceneRef.current?.style.setProperty("--song-progress", String(progress));
  }, []);

  return (
    <main
      ref={sceneRef}
      className={`${styles.playerScene}${isPlaying ? ` ${styles.isPlaying}` : ""}${isMoving ? ` ${styles.isMoving}` : ""}`}
      style={{ "--accent-hue": hue, "--song-progress": 0 } as CSSProperties}
    >
      <div className={styles.nebula} aria-hidden="true" />
      <div className={styles.auroraVeil} aria-hidden="true" />

      <div className={styles.galaxyLayer} aria-hidden="true">
        <Galaxy
          disableAnimation={false}
          hueShift={hue}
          saturation={0.68}
          mouseInteraction={false}
          mouseRepulsion={false}
          density={0.7}
          glowIntensity={0.27}
          twinkleIntensity={0.3}
          rotationSpeed={0.035}
          recede={isMoving ? 1 : 0}
        />
      </div>

      <div className={styles.cosmicStrata} aria-hidden="true" />

      <svg
        className={styles.constellationLayer}
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <g className={styles.constellationLines}>
          <path d="M96 190 L184 126 L278 174 L340 104 L418 158" />
          <path d="M184 126 L212 230 L278 174 L326 260" />
          <path d="M1212 744 L1284 676 L1360 724 L1438 646 L1510 704" />
          <path d="M1284 676 L1320 816 L1360 724 L1448 806" />
        </g>
        <g className={styles.constellationNodes}>
          <circle cx="96" cy="190" r="3" />
          <circle cx="184" cy="126" r="5" />
          <circle cx="278" cy="174" r="3.5" />
          <circle cx="340" cy="104" r="4.5" />
          <circle cx="418" cy="158" r="2.5" />
          <circle cx="212" cy="230" r="2.5" />
          <circle cx="326" cy="260" r="3" />
          <circle cx="1212" cy="744" r="3" />
          <circle cx="1284" cy="676" r="4.5" />
          <circle cx="1360" cy="724" r="3" />
          <circle cx="1438" cy="646" r="5" />
          <circle cx="1510" cy="704" r="2.5" />
          <circle cx="1320" cy="816" r="2.5" />
          <circle cx="1448" cy="806" r="3.5" />
        </g>
      </svg>

      <div className={styles.starScrim} aria-hidden="true" />
      <div className={styles.discAura} aria-hidden="true" />

      <div className={styles.playerLayer}>
        <InfiniteMenu
          items={items}
          onPlayingChange={setIsPlaying}
          onColorChange={setHue}
          onMovementChange={setIsMoving}
          onProgressChange={handleProgressChange}
          onPlaybackDetailChange={setPlaybackDetail}
          onFavoriteChange={setIsFavorite}
        />
      </div>

      <MagneticDiscovery
        isPlaying={isPlaying}
        isMoving={isMoving}
        isFavorite={isFavorite}
        playbackDetail={playbackDetail}
        songCatalog={items.map(({ title, artist }) => ({ title, artist }))}
      />
    </main>
  );
}
