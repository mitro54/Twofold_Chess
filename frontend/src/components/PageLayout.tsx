import React from 'react';
import { useState, useEffect } from 'react';

const ChessBackground = () => {
  const [pieces, setPieces] = useState<Array<{ x: number; y: number; type: string; color: string }>>([]);

  useEffect(() => {
    // Create initial pieces
    const initialPieces = Array.from({ length: 12 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      type: ['♟', '♜', '♞', '♝', '♛', '♚'][Math.floor(Math.random() * 6)],
      color: Math.random() > 0.5 ? 'text-white' : 'text-gray-800'
    }));
    setPieces(initialPieces);

    // Animate pieces
    const interval = setInterval(() => {
      setPieces(currentPieces => 
        currentPieces.map(piece => ({
          ...piece,
          x: (piece.x + (Math.random() - 0.5) * 2) % 100,
          y: (piece.y + (Math.random() - 0.5) * 2) % 100
        }))
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {pieces.map((piece, index) => (
        <div
          key={index}
          className={`absolute text-4xl transition-all duration-2000 ${piece.color}`}
          style={{
            left: `${piece.x}%`,
            top: `${piece.y}%`,
            transform: 'translate(-50%, -50%)',
            opacity: 0.2
          }}
        >
          {piece.type}
        </div>
      ))}
    </div>
  );
};

interface PageLayoutProps {
  children: React.ReactNode;
  title?: string;
  titleClassName?: string;
  allowScroll?: boolean;
}

const PageLayout: React.FC<PageLayoutProps> = ({ children, title, titleClassName, allowScroll }) => {
  return (
    <div className={`relative ${allowScroll ? 'min-h-screen' : 'h-[100dvh]'} flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 to-black ${allowScroll ? 'overflow-auto' : 'overflow-hidden'}`}>
      <ChessBackground />
      
      <div className="relative z-10 text-center w-full max-w-4xl mx-auto px-4">
        {title && (
          <h1 className={`text-6xl sm:text-7xl font-bold ${titleClassName || 'mb-20 sm:mb-50'} bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 animate-gradient-x font-['Playfair_Display'] tracking-wider`}>
            {title}
          </h1>
        )}
        {children}
      </div>
    </div>
  );
};

export default PageLayout; 