import InfiniteMenu from "@/components/InfiniteMenu";

const items = [
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
  },
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
  },
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
  },
  {
    image: "/p/changes.webp",
    title: "Changes",
    artist: "Justin Bieber",
  },
];

export default function Home() {
  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <InfiniteMenu
        items={items}
        audioSrc="/m/Justin Bieber-Changes.mp3"
        lrcSrc="/lrc/Justin Bieber-Changes.lrc"
      />
    </div>
  );
}
