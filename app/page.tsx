'use client';

import { useState } from "react";
import InfiniteMenu from "@/components/InfiniteMenu";
import Galaxy from "@/components/Galaxy";

const items = [
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
    audio: "/m/Justin Bieber-Changes.mp3",
    lrc: "/lrc/Changes-Justin Bieber-歌词.lrc",
  },
  {
    image: "/p/Attention.jpg",
    title: "Attention",
    artist: "NewJeans",
    audio: "/m/Attention-NewJeans+(뉴진스).mp3",
    lrc: "/lrc/Attention-NewJeans (뉴진스)-歌词.lrc",
  },
  {
    image: "/p/ditto.jpg",
    title: "Ditto",
    artist: "NewJeans",
    audio: "/m/Ditto-NewJeans+(뉴진스).mp3",
    lrc: "/lrc/Ditto-NewJeans (뉴진스)-歌词.lrc",
  },
  {
    image: "/p/Magnetic.jpg",
    title: "Magnetic",
    artist: "ILLIT",
    audio: "/m/ILLIT-magnetic.mp3",
    lrc: "/lrc/Magnetic-ILLIT-歌词.lrc",
  },
  {
    image: "/p/圣诞星.jpg",
    title: "圣诞星",
    artist: "周杰伦 (feat. 杨瑞代)",
    audio: "/m/圣诞星+(feat.+杨瑞代)-周杰伦.mp3",
    lrc: "/lrc/圣诞星 (feat. 杨瑞代)-周杰伦-歌词.lrc",
  },
];

export default function Home() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
        }}
      >
        <Galaxy
          disableAnimation={!isPlaying}
          mouseInteraction={false}
          mouseRepulsion={false}
          density={1.2}
          glowIntensity={0.4}
          twinkleIntensity={0.4}
          rotationSpeed={0.05}
        />
      </div>
      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%" }}>
        <InfiniteMenu items={items} onPlayingChange={setIsPlaying} />
      </div>
    </div>
  );
}
