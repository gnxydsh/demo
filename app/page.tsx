import InfiniteMenu from "@/components/InfiniteMenu";

const items = [
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
    audio: "/m/Justin Bieber-Changes.mp3",
    lrc: "/lrc/Changes-Justin Bieber-歌词.lrc",
  },
  {
    image: "/p/attention.jpg",
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
];

export default function Home() {
  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <InfiniteMenu items={items} />
    </div>
  );
}
