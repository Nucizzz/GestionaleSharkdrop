import { create } from 'zustand';
import { Location, Shelf, Product, InventoryLevel } from '../types';

interface AppState {
  locations: Location[];
  shelves: Shelf[];
  currentLocation: Location | null;
  currentShelf: Shelf | null;
  scannedProduct: { product: Product; variant: any } | null;
  setLocations: (locations: Location[]) => void;
  setShelves: (shelves: Shelf[]) => void;
  setCurrentLocation: (location: Location | null) => void;
  setCurrentShelf: (shelf: Shelf | null) => void;
  setScannedProduct: (data: { product: Product; variant: any } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  locations: [],
  shelves: [],
  currentLocation: null,
  currentShelf: null,
  scannedProduct: null,

  setLocations: (locations) => set({ locations }),
  setShelves: (shelves) => set({ shelves }),
  setCurrentLocation: (location) => set({ currentLocation: location }),
  setCurrentShelf: (shelf) => set({ currentShelf: shelf }),
  setScannedProduct: (data) => set({ scannedProduct: data }),
}));
