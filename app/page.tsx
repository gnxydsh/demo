import InfiniteMenu from "@/components/InfiniteMenu";

const items = [
  {
    image: "/p/changes.webp",
    link: "https://google.com/",
    title: "Item 1",
    description: "This is pretty cool, right?",
  },
  {
    image: "/p/changes.webp",
    link: "https://google.com/",
    title: "Item 2",
    description: "This is pretty cool, right?",
  },
  {
    image: "/p/changes.webp",
    link: "https://google.com/",
    title: "Item 3",
    description: "This is pretty cool, right?",
  },
  {
    image: "/p/changes.webp",
    link: "https://google.com/",
    title: "Item 4",
    description: "This is pretty cool, right?",
  },
];

export default function Home() {
  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <InfiniteMenu items={items} />
    </div>
  );
}
