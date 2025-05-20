interface Lobby {
  roomId: string;
  host: string;
  isPrivate: boolean;
  createdAt: number;
  players: string[];
}

class LobbyManager {
  private lobbies: Map<string, Lobby>;
  private readonly LOBBY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.lobbies = new Map();
    this.startCleanupInterval();
  }

  createLobby(roomId: string, host: string, isPrivate: boolean): Lobby {
    const lobby: Lobby = {
      roomId,
      host,
      isPrivate,
      createdAt: Date.now(),
      players: [host]
    };
    this.lobbies.set(roomId, lobby);
    return lobby;
  }

  getLobbies(): Lobby[] {
    return Array.from(this.lobbies.values())
      .filter(lobby => !lobby.isPrivate)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getLobby(roomId: string): Lobby | undefined {
    return this.lobbies.get(roomId);
  }

  removeLobby(roomId: string): boolean {
    return this.lobbies.delete(roomId);
  }

  addPlayerToLobby(roomId: string, player: string): boolean {
    const lobby = this.lobbies.get(roomId);
    if (lobby && !lobby.players.includes(player)) {
      lobby.players.push(player);
      return true;
    }
    return false;
  }

  removePlayerFromLobby(roomId: string, player: string): boolean {
    const lobby = this.lobbies.get(roomId);
    if (lobby) {
      const index = lobby.players.indexOf(player);
      if (index > -1) {
        lobby.players.splice(index, 1);
        if (lobby.players.length === 0) {
          this.removeLobby(roomId);
        }
        return true;
      }
    }
    return false;
  }

  private startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [roomId, lobby] of this.lobbies.entries()) {
        if (now - lobby.createdAt > this.LOBBY_TIMEOUT) {
          this.removeLobby(roomId);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }
}

export const lobbyManager = new LobbyManager(); 