import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export default function CustomCursor() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const updateMousePosition = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Detect a, button, inputs, or anything explicitly marked hoverable
      // Fix: Use .closest() to ensure child elements of .cursor-hover still trigger the effect
      if (
        target.tagName.toLowerCase() === 'a' || 
        target.closest('a') || 
        target.tagName.toLowerCase() === 'button' || 
        target.closest('button') ||
        target.classList.contains('cursor-hover') ||
        target.closest('.cursor-hover')
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    window.addEventListener('mousemove', updateMousePosition);
    window.addEventListener('mouseover', handleMouseOver);

    return () => {
      window.removeEventListener('mousemove', updateMousePosition);
      window.removeEventListener('mouseover', handleMouseOver);
    };
  }, []);

  return (
    <motion.div
      className="fixed top-0 left-0 w-8 h-8 rounded-full pointer-events-none z-[999] flex items-center justify-center mix-blend-difference"
      animate={{
        x: mousePosition.x - 16,
        y: mousePosition.y - 16,
        scale: isHovering ? 2.5 : 1,
        backgroundColor: isHovering ? '#ffffff' : 'transparent',
        border: isHovering ? 'none' : '1px solid rgba(255, 255, 255, 0.5)',
      }}
      transition={{ type: 'tween', ease: 'backOut', duration: 0.15 }}
    >
      {!isHovering && <div className="w-1 h-1 bg-white rounded-full" />}
    </motion.div>
  );
}
