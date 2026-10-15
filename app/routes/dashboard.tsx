import type { Route } from "./+types/dashboard";
import logo from "../images/abodeo-home-logo.jpeg";

export const meta: Route.MetaFunction = () => [
  { title: "Dashboard - Abodeo" },
  { name: "description", content: "Your home, sorted." },
];

export default function Dashboard() {
  return (
    <div className="dashboard">
      <header>
        <h1>
          <img
            src={logo}
            alt="Abodeo - Your home, sorted."
            width={997}
            height={868}
          />
        </h1>
      </header>
      <main>
        <p>No projects added yet.</p>
      </main>
    </div>
  );
}
