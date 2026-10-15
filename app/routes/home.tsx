import type { Route } from "./+types/home";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Home() {
  return (
    <main className="welcome">
      <h1>
        <img
          src={logo}
          alt="Abodeo - Your home, sorted."
          width={997}
          height={868}
        />
      </h1>
    </main>
  );
}
