import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { InventoryLevel, Location } from '../../src/types';
import { ProductCard } from '../../src/components/ProductCard';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [inventory, setInventory] = useState<InventoryLevel[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [collections, setCollections] = useState<any[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [inv, locs, colls] = await Promise.all([
        api.getInventorySummary(selectedLocation || undefined),
        api.getLocations(),
        api.getCollections().catch(() => []),
      ]);
      setInventory(inv);
      setLocations(locs);
      setCollections(colls || []);
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedLocation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [selectedLocation]);

  const totalItems = inventory.reduce((sum, item) => sum + item.quantity, 0);

  const filteredInventory = inventory.filter((item) => {
    if (collectionFilter) {
      const coll = collections.find((c) => c.id === collectionFilter);
      if (coll?.product_ids?.length && !coll.product_ids.includes(item.product_id)) {
        return false;
      }
    }
    if (sizeFilter.trim()) {
      const size = sizeFilter.trim().toLowerCase();
      if (!(item.variant_title || '').toLowerCase().includes(size)) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${item.product_title || ''} ${item.variant_title || ''} ${item.variant_barcode || ''} ${item.variant_sku || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Inventario</Text>
        <View style={styles.statsRow}>
          <Text style={styles.totalItems}>{totalItems} pezzi</Text>
          <Text style={styles.totalVariants}>{inventory.length} varianti</Text>
        </View>
      </View>

      {/* Location Filter */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, !selectedLocation && styles.filterButtonActive]}
          onPress={() => setSelectedLocation(null)}
        >
          <Text style={[styles.filterButtonText, !selectedLocation && styles.filterButtonTextActive]}>
            Tutte
          </Text>
        </TouchableOpacity>
        {locations.map((loc) => (
          <TouchableOpacity
            key={loc.id}
            style={[styles.filterButton, selectedLocation === loc.id && styles.filterButtonActive]}
            onPress={() => setSelectedLocation(loc.id)}
          >
            <Text style={[styles.filterButtonText, selectedLocation === loc.id && styles.filterButtonTextActive]}>
              {loc.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search + Filters */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Ionicons name="search" size={18} color="#999" />
          <TextInput
            style={styles.searchText}
            placeholder="Cerca nome, barcode, SKU..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity onPress={() => setShowScanner(true)}>
            <Ionicons name="barcode-outline" size={20} color="#111" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFilters(true)}>
          <Ionicons name="options-outline" size={18} color="#111" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredInventory}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProductCard
            inventory={item}
            onPress={() => router.push(`/product-detail?id=${item.product_id}`)}
            onEditProduct={() => router.push(`/product-detail?id=${item.product_id}`)}
            onReceive={() => router.push(`/operation?type=receive&product_id=${item.product_id}&variant_id=${item.variant_id}&location_id=${item.location_id}&shelf_id=${item.shelf_id || ''}`)}
            onSale={() => router.push(`/operation?type=sale&product_id=${item.product_id}&variant_id=${item.variant_id}&location_id=${item.location_id}&shelf_id=${item.shelf_id || ''}`)}
            onMove={() => router.push(`/operation?type=move&product_id=${item.product_id}&variant_id=${item.variant_id}&location_id=${item.location_id}&shelf_id=${item.shelf_id || ''}`)}
            onStall={() => router.push(`/(tabs)/stallo?variant_id=${item.variant_id}&location_id=${item.location_id}&shelf_id=${item.shelf_id || ''}`)}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Nessun inventario</Text>
            <Text style={styles.emptyHint}>Ricevi prodotti per vedere l'inventario</Text>
          </View>
        }
      />

      <Modal visible={showFilters} animationType="slide" transparent onRequestClose={() => setShowFilters(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filtri Inventario</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Taglia (es. 42, M)"
              value={sizeFilter}
              onChangeText={setSizeFilter}
            />
            {collections.length > 0 && (
              <>
                <Text style={styles.modalLabel}>Collection</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modalScroll}>
                  <View style={styles.modalOptions}>
                    <TouchableOpacity
                      style={[styles.optionChip, !collectionFilter && styles.optionChipActive]}
                      onPress={() => setCollectionFilter(null)}
                    >
                      <Text style={[styles.optionText, !collectionFilter && styles.optionTextActive]}>Tutte</Text>
                    </TouchableOpacity>
                    {collections.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.optionChip, collectionFilter === c.id && styles.optionChipActive]}
                        onPress={() => setCollectionFilter(c.id)}
                      >
                        <Text style={[styles.optionText, collectionFilter === c.id && styles.optionTextActive]}>
                          {c.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => {
                setSizeFilter('');
                setCollectionFilter(null);
              }}>
                <Text style={styles.modalBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={() => setShowFilters(false)}>
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Applica</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => setSearchQuery(code)}
        title="Scansiona Barcode"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  totalItems: {
    fontSize: 14,
    color: '#666',
    marginRight: 16,
  },
  totalVariants: {
    fontSize: 14,
    color: '#666',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: '#000',
  },
  filterButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchText: {
    flex: 1,
    fontSize: 14,
    color: '#111',
  },
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  list: {
    padding: 16,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 14,
  },
  modalLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  modalOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalScroll: {
    maxHeight: 60,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  optionText: {
    fontSize: 12,
    color: '#000',
  },
  optionTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
  },
  modalBtnPrimary: {
    backgroundColor: '#000',
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  modalBtnTextPrimary: {
    color: '#fff',
  },
});
