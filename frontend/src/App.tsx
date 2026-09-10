import Preloader from './components/Preloader';
import SmoothScroll from './components/SmoothScroll';
import Hero from './components/sections/Hero';
import Manifesto from './components/sections/Manifesto';
import Capabilities from './components/sections/Capabilities';
import SystemArchitecture from './components/sections/SystemArchitecture';
import Metrics from './components/sections/Metrics';
import FinalCTA from './components/sections/FinalCTA';
import Scene from './components/canvas/Scene';
import CustomCursor from './components/CustomCursor';

function App() {
  return (
    <>
      <Preloader />
      <CustomCursor />
      <SmoothScroll>
        <div className="relative w-full bg-[#050505]">
          {/* Fixed 3D WebGL Background Scene */}
          <div className="fixed inset-0 z-0 pointer-events-none">
            <Scene />
          </div>

          {/* Scrolling UI Layers */}
          <div className="relative z-10 pointer-events-none">
            <Hero />
            <Manifesto />
            <Capabilities />
            <Metrics />
            <SystemArchitecture />
            <FinalCTA />
          </div>
        </div>
      </SmoothScroll>
    </>
  );
}

export default App;
