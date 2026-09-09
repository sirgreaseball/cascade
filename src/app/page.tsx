import BreachControlPanel from '@/components/panels/BreachControlPanel';
import ImpactPanel from '@/components/panels/ImpactPanel';
import AlertLog from '@/components/panels/AlertLog';
import Header from '@/components/panels/Header';
import MapView from '@/components/map/MapView';
import SimulationController from '@/components/SimulationController';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0f172a]">
      {/* 3D Map Background */}
      <MapView />
      
      {/* Logic Controller (No UI) */}
      <SimulationController />

      {/* UI Overlay */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <Header />
        <BreachControlPanel />
        <ImpactPanel />
        <AlertLog />
      </div>
    </main>
  );
}
