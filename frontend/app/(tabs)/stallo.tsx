import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/services/api';
import { Button } from '../../src/components/Button';
import { InventoryLevel, Location, Shelf, StallItem } from '../../src/types';

export default function StalloScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant_id?: string; location_id?: string; shelf_id?: string }>();

  const [inventory, setInventory] = useState<InventoryLevel[]>([]);
  const [stallItems, setStallItems] = useState<StallItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryLevel | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [customerName, setCustomerName] = useState('');

  const [actionModal, setActionModal] = useState<{ visible: boolean; type: 'move' | 'sell'; item: StallItem | null }>(
    { visible: false, type: 'move', item: null }
  );
  const [actionLocationId, setActionLocationId] = useState<string | null>(null);
  const [actionShelfId, setActionShelfId] = useState<string | null>(null);
  const [salePrice, setSalePrice] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [inv, stall, locs, sh] = await Promise.all([
        api.getInventorySummary(),
        api.getStallItems('in_stallo').catch(() => []),
        api.getLocations(),
        api.getShelves(),
      ]);
      setInventory(inv || []);
      setStallItems(stall || []);
      setLocations(locs || []);
      setShelves(sh || []);
      if (params.variant_id) {
        const match = (inv || []).find((i: InventoryLevel) => i.variant_id === params.variant_id);
        if (match) {
          setSelectedItem(match);
        }
      }
    } catch (error) {
      console.error('Error loading stallo data:', error);
    } finally {
      setLoading(false);
    }
  }, [params.variant_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredInventory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inventory;
    const tokens = q.split(/\s+/).filter(Boolean);
    return inventory.filter((item) => {
      const hay = `${item.product_title || ''} ${item.variant_title || ''} ${item.variant_barcode || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [inventory, searchQuery]);

  const handleCreateStall = async () => {
    if (!selectedItem) {
      Alert.alert('Errore', 'Seleziona un prodotto dall\'inventario');
      return;
    }
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) {
      Alert.alert('Errore', 'Quantita non valida');
      return;
    }

    try {
      await api.createStallItem({
        variant_id: selectedItem.variant_id,
        location_id: selectedItem.location_id,
        shelf_id: selectedItem.shelf_id,
        quantity: qty,
        note: note.trim() || undefined,
        customer_name: customerName.trim() || undefined,
      });
      Alert.alert('Ok', 'Prodotto messo in stallo');
      setSelectedItem(null);
      setQuantity('1');
      setNote('');
      setCustomerName('');
      loadData();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore durante lo stallo');
    }
  };

  const handleReturn = async (item: StallItem) => {
    try {
      await api.returnStallItem(item.id, {});
      loadData();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore durante il rientro');
    }
  };

  const openMoveModal = (item: StallItem) => {
    setActionModal({ visible: true, type: 'move', item });
    setActionLocationId(item.from_location_id || null);
    setActionShelfId(item.from_shelf_id || null);
  };

  const openSellModal = (item: StallItem) => {
    setActionModal({ visible: true, type: 'sell', item });
    setSalePrice('');
  };

  const confirmMove = async () => {
    if (!actionModal.item || !actionLocationId) {
      Alert.alert('Errore', 'Seleziona una location');
      return;
    }
    try {
      await api.moveStallItem(actionModal.item.id, {
        to_location_id: actionLocationId,
        to_shelf_id: actionShelfId || undefined,
      });
      setActionModal({ visible: false, type: 'move', item: null });
      loadData();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore durante lo spostamento');
    }
  };

  const confirmSell = async () => {
    if (!actionModal.item) return;
    try {
      const price = parseFloat(salePrice);
      await api.sellStallItem(actionModal.item.id, { sale_price: isNaN(price) ? undefined : price });
      setActionModal({ visible: false, type: 'sell', item: null });
      loadData();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore durante la vendita');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento...</Text>
      </View>
    );
  }

  const shelvesForLocation = shelves.filter((s) => s.location_id === actionLocationId);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Stallo</Text>
        <TouchableOpacity onPress={loadData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>In Stallo ({stallItems.length})</Text>
          {stallItems.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Nessun prodotto in stallo</Text>
            </View>
          ) : (
            stallItems.map((item) => (
              <View key={item.id} style={styles.card}>
                <Text style={styles.cardTitle}>{item.product_title || 'Prodotto'}</Text>
                <Text style={styles.cardSubtitle}>{item.variant_title || 'Variante'} • Qty {item.quantity}</Text>
                {!!item.customer_name && <Text style={styles.cardNote}>Cliente: {item.customer_name}</Text>}
                {!!item.note && <Text style={styles.cardNote}>Note: {item.note}</Text>}
                <Text style={styles.cardMeta}>Da: {item.from_location_name || 'N/A'} {item.from_shelf_name ? `• ${item.from_shelf_name}` : ''}</Text>
                <View style={styles.cardActions}>
                  <Button title="Rimetti" onPress={() => handleReturn(item)} variant="outline" />
                  <Button title="Sposta" onPress={() => openMoveModal(item)} variant="outline" />
                  <Button title="Venduto" onPress={() => openSellModal(item)} variant="danger" />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Metti in Stallo</Text>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#999" />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca per nome o barcode..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Prodotto selezionato</Text>
            <Text style={styles.value}>{selectedItem ? `${selectedItem.product_title} • ${selectedItem.variant_title}` : 'Nessuno'}</Text>
            <Text style={styles.metaValue}>
              {selectedItem ? `${selectedItem.location_name || 'N/A'} ${selectedItem.shelf_name ? `• ${selectedItem.shelf_name}` : ''} • Qty ${selectedItem.quantity}` : ''}
            </Text>

            <View style={styles.row}>
              <TextInput
                style={styles.input}
                placeholder="Quantita"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Cliente (opz.)"
                value={customerName}
                onChangeText={setCustomerName}
              />
            </View>
            <TextInput
              style={[styles.input, styles.noteInput]}
              placeholder="Note (opzionali)"
              value={note}
              onChangeText={setNote}
              multiline
            />
            <Button title="Metti in Stallo" onPress={handleCreateStall} />
          </View>

          <View style={styles.inventoryList}>
            {filteredInventory.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.inventoryItem, selectedItem?.id === item.id && styles.inventoryItemSelected]}
                onPress={() => setSelectedItem(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.inventoryTitle}>{item.product_title || 'Prodotto'}</Text>
                  <Text style={styles.inventorySubtitle}>{item.variant_title || 'Variante'} • Qty {item.quantity}</Text>
                  <Text style={styles.inventoryMeta}>{item.location_name || 'N/A'} {item.shelf_name ? `• ${item.shelf_name}` : ''}</Text>
                </View>
                <Ionicons name={selectedItem?.id === item.id ? 'checkmark-circle' : 'chevron-forward'} size={20} color={selectedItem?.id === item.id ? '#22c55e' : '#999'} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={actionModal.visible}
        animationType="slide"
        transparent
        onRequestClose={() => setActionModal({ visible: false, type: 'move', item: null })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{actionModal.type === 'move' ? 'Sposta in' : 'Segna Venduto'}</Text>

            {actionModal.type === 'move' ? (
              <>
                <Text style={styles.modalLabel}>Location</Text>
                <View style={styles.modalOptions}>
                  {locations.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      style={[styles.optionChip, actionLocationId === loc.id && styles.optionChipActive]}
                      onPress={() => setActionLocationId(loc.id)}
                    >
                      <Text style={[styles.optionText, actionLocationId === loc.id && styles.optionTextActive]}>{loc.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.modalLabel}>Scaffale (opz.)</Text>
                <View style={styles.modalOptions}>
                  <TouchableOpacity
                    style={[styles.optionChip, !actionShelfId && styles.optionChipActive]}
                    onPress={() => setActionShelfId(null)}
                  >
                    <Text style={[styles.optionText, !actionShelfId && styles.optionTextActive]}>Nessuno</Text>
                  </TouchableOpacity>
                  {shelvesForLocation.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.optionChip, actionShelfId === s.id && styles.optionChipActive]}
                      onPress={() => setActionShelfId(s.id)}
                    >
                      <Text style={[styles.optionText, actionShelfId === s.id && styles.optionTextActive]}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.modalActions}>
                  <Button title="Annulla" onPress={() => setActionModal({ visible: false, type: 'move', item: null })} variant="outline" />
                  <Button title="Conferma" onPress={confirmMove} />
                </View>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Prezzo vendita (opz.)"
                  value={salePrice}
                  onChangeText={setSalePrice}
                  keyboardType="decimal-pad"
                />
                <View style={styles.modalActions}>
                  <Button title="Annulla" onPress={() => setActionModal({ visible: false, type: 'sell', item: null })} variant="outline" />
                  <Button title="Conferma" onPress={confirmSell} variant="danger" />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#000' },
  refreshBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8, textTransform: 'uppercase' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 12 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#e0e0e0' },
  emptyText: { textAlign: 'center', color: '#999' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  cardSubtitle: { fontSize: 13, color: '#666', marginTop: 4 },
  cardNote: { fontSize: 12, color: '#92400e', marginTop: 4 },
  cardMeta: { fontSize: 12, color: '#999', marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12, borderRadius: 10, gap: 8, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  label: { fontSize: 12, color: '#666', marginBottom: 4 },
  value: { fontSize: 14, color: '#000', marginBottom: 4 },
  metaValue: { fontSize: 12, color: '#999', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#e0e0e0', fontSize: 14 },
  noteInput: { minHeight: 60, textAlignVertical: 'top' },
  inventoryList: { marginTop: 8 },
  inventoryItem: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  inventoryItemSelected: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  inventoryTitle: { fontSize: 14, fontWeight: '600', color: '#000' },
  inventorySubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  inventoryMeta: { fontSize: 11, color: '#999', marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 12 },
  modalLabel: { fontSize: 12, color: '#666', marginBottom: 6, marginTop: 6 },
  modalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0' },
  optionChipActive: { backgroundColor: '#000', borderColor: '#000' },
  optionText: { fontSize: 12, color: '#000' },
  optionTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
});
