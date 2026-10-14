import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [
  { title: "Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Home() {
  return (
    <main className="welcome">
      <h1>Abodeo</h1>
      <p>Your home, sorted.</p>
    </main>
  );
}
