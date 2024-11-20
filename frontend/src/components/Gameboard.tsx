import React from "react";

const Gameboard: React.FC = () => {
  const rows = Array.from({ length: 8 }, (_, rowIndex) => rowIndex);
  const cols = Array.from({ length: 8 }, (_, colIndex) => colIndex);

  const isBlackSquare = (row: number, col: number) => (row + col) % 2 === 1;

  return (
    <div className="grid grid-cols-8 w-[400px] h-[400px]">
      {rows.map((row) =>
        cols.map((col) => (
          <div
            key={`${row}-${col}`}
            className={`w-full h-full ${
              isBlackSquare(row, col) ? "bg-[#b58863]" : "bg-[#f0d9b5]"
            }`}
          />
        ))
      )}
    </div>
  );
};

export default Gameboard;
