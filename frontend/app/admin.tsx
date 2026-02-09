import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { BarcodeScanner } from '../src/components/BarcodeScanner';
import { Location, Shelf } from '../src/types';
import { safeBack } from '../src/utils/safeBack';

type TabType = 'locations' | 'shelves';

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState<TabType>('locations');
  const [locations, setLocations] = useState<Location[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showShelfModal, setShowShelfModal] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [editingShelf, setEditingShelf] = useState<Shelf | null>(null);
  
  // Form states
  const [locationName, setLocationName] = useState('');
  const [locationDescription, setLocationDescription] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [shelfBarcode, setShelfBarcode] = useState('');
  const [shelfLocationId, setShelfLocationId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [locs, shelvesData] = await Promise.all([
        api.getLocations(),
        api.getShelves(),
      ]);
      setLocations(locs);
      setShelves(shelvesData);
    } catch (error) {
      console.error('Error loading admin data:', error);
      Alert.alert('Errore', 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check admin access
  useEffect(() => {
    if (user && user.role !== 'admin') {
      Alert.alert('Accesso Negato', 'Solo gli admin possono accedere a questa pagina');
      safeBack(router);
    }
  }, [user]);

  // Location handlers
  const openLocationModal = (location?: Location) => {
    if (location) {
      setEditingLocation(location);
      setLocationName(location.name);
      setLocationDescription(location.description || '');
    } else {
      setEditingLocation(null);
      setLocationName('');
      setLocationDescription('');
    }
    setShowLocationModal(true);
  };

  const saveLocation = async () => {
    if (!locationName.trim()) {
      Alert.alert('Errore', 'Inserisci un nome per la location');
      return;
    }

    setSaving(true);
    try {
      if (editingLocation) {
        await api.updateLocation(editingLocation.id, {
          name: locationName.trim(),
          description: locationDescription.trim() || undefined,
        });
      } else {
        await api.createLocation({
          name: locationName.trim(),
          description: locationDescription.trim() || undefined,
        });
      }
      setShowLocationModal(false);
      loadData();
      Alert.alert('Successo', editingLocation ? 'Location aggiornata' : 'Location creata');
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const deleteLocation = async (location: Location) => {
    Alert.alert(
      'Elimina Location',
      `Sei sicuro di voler eliminare "${location.name}"? Tutti gli scaffali associati saranno eliminati.`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteLocation(location.id);
              loadData();
              Alert.alert('Successo', 'Location eliminata');
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore eliminazione');
            }
          },
        },
      ]
    );
  };

  // Shelf handlers
  const openShelfModal = (shelf?: Shelf) => {
    // Check if we have locations
    if (locations.length === 0) {
      Alert.alert(
        'Nessuna Location',
        'Devi prima creare almeno una Location prima di poter aggiungere uno scaffale.',
        [
          { text: 'OK' },
          { 
            text: 'Crea Location', 
            onPress: () => {
              setActiveTab('locations');
              openLocationModal();
            }
          }
        ]
      );
      return;
    }

    if (shelf) {
      setEditingShelf(shelf);
      setShelfName(shelf.name);
      setShelfBarcode(shelf.barcode);
      setShelfLocationId(shelf.location_id);
    } else {
      setEditingShelf(null);
      setShelfName('');
      setShelfBarcode('');
      setShelfLocationId(locations[0]?.id || '');
    }
    setShowShelfModal(true);
  };

  const handleBarcodeScan = (barcode: string) => {
    setShelfBarcode(barcode);
    setShowBarcodeScanner(false);
  };

  const saveShelf = async () => {
    if (!shelfName.trim()) {
      Alert.alert('Errore', 'Inserisci un nome per lo scaffale');
      return;
    }
    if (!shelfBarcode.trim()) {
      Alert.alert('Errore', 'Inserisci o scansiona un barcode');
      return;
    }
    if (!shelfLocationId) {
      Alert.alert('Errore', 'Seleziona una location');
      return;
    }

    setSaving(true);
    try {
      if (editingShelf) {
        await api.updateShelf(editingShelf.id, {
          name: shelfName.trim(),
          barcode: shelfBarcode.trim(),
          location_id: shelfLocationId,
        });
      } else {
        await api.createShelf({
          name: shelfName.trim(),
          barcode: shelfBarcode.trim(),
          location_id: shelfLocationId,
        });
      }
      setShowShelfModal(false);
      loadData();
      Alert.alert('Successo', editingShelf ? 'Scaffale aggiornato' : 'Scaffale creato');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Errore nel salvataggio';
      if (errorMsg.includes('already exists')) {
        Alert.alert('Errore', 'Questo barcode esiste già. Usa un barcode diverso.');
      } else {
        Alert.alert('Errore', errorMsg);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteShelf = async (shelf: Shelf) => {
    Alert.alert(
      'Elimina Scaffale',
      `Sei sicuro di voler eliminare "${shelf.name}" (${shelf.barcode})?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteShelf(shelf.id);
              loadData();
              Alert.alert('Successo', 'Scaffale eliminato');
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore eliminazione');
            }
          },
        },
      ]
    );
  };

  const getLocationName = (locationId: string) => {
    return locations.find(l => l.id === locationId)?.name || 'Sconosciuta';
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => safeBack(router)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Gestione Admin</Text>
        <TouchableOpacity onPress={loadData} style={styles.backButton}>
          <Ionicons name="refresh" size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'locations' && styles.tabActive]}
          onPress={() => setActiveTab('locations')}
        >
          <Ionicons name="location-outline" size={20} color={activeTab === 'locations' ? '#000' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'locations' && styles.tabTextActive]}>
            Location ({locations.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'shelves' && styles.tabActive]}
          onPress={() => setActiveTab('shelves')}
        >
          <Ionicons name="grid-outline" size={20} color={activeTab === 'shelves' ? '#000' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'shelves' && styles.tabTextActive]}>
            Scaffali ({shelves.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
        {activeTab === 'locations' ? (
          <>
            {locations.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="location-outline" size={48} color="#ccc" />
                <Text style={styles.emptyTitle}>Nessuna Location</Text>
                <Text style={styles.emptyText}>Crea la prima location per iniziare</Text>
              </View>
            ) : (
              locations.map((location) => (
                <View key={location.id} style={styles.itemCard}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{location.name}</Text>
                    {location.description && (
                      <Text style={styles.itemDescription}>{location.description}</Text>
                    )}
                    <Text style={styles.itemMeta}>
                      {shelves.filter(s => s.location_id === location.id).length} scaffali
                    </Text>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => openLocationModal(location)}
                    >
                      <Ionicons name="pencil" size={20} color="#2563eb" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => deleteLocation(location)}
                    >
                      <Ionicons name="trash" size={20} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          <>
            {shelves.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="grid-outline" size={48} color="#ccc" />
                <Text style={styles.emptyTitle}>Nessuno Scaffale</Text>
                <Text style={styles.emptyText}>
                  {locations.length === 0 
                    ? 'Crea prima una Location' 
                    : 'Aggiungi il primo scaffale'}
                </Text>
              </View>
            ) : (
              locations.map((location) => {
                const locationShelves = shelves.filter(s => s.location_id === location.id);
                if (locationShelves.length === 0) return null;
                
                return (
                  <View key={location.id}>
                    <Text style={styles.sectionHeader}>{location.name}</Text>
                    {locationShelves.map((shelf) => (
                      <View key={shelf.id} style={styles.itemCard}>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName}>{shelf.name}</Text>
                          <Text style={styles.itemBarcode}>{shelf.barcode}</Text>
                        </View>
                        <View style={styles.itemActions}>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => openShelfModal(shelf)}
                          >
                            <Ionicons name="pencil" size={20} color="#2563eb" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => deleteShelf(shelf)}
                          >
                            <Ionicons name="trash" size={20} color="#dc2626" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => activeTab === 'locations' ? openLocationModal() : openShelfModal()}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Location Modal */}
      <Modal
        visible={showLocationModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowLocationModal(false)}>
                <Text style={styles.modalCancel}>Annulla</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingLocation ? 'Modifica Location' : 'Nuova Location'}
              </Text>
              <TouchableOpacity onPress={saveLocation} disabled={saving}>
                <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>
                  {saving ? '...' : 'Salva'}
                </Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Input
                label="Nome *"
                value={locationName}
                onChangeText={setLocationName}
                placeholder="es. Warehouse, Negozio Jesolo"
              />
              <Input
                label="Descrizione"
                value={locationDescription}
                onChangeText={setLocationDescription}
                placeholder="es. Magazzino principale"
                multiline
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Shelf Modal */}
      <Modal
        visible={showShelfModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowShelfModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowShelfModal(false)}>
                <Text style={styles.modalCancel}>Annulla</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingShelf ? 'Modifica Scaffale' : 'Nuovo Scaffale'}
              </Text>
              <TouchableOpacity onPress={saveShelf} disabled={saving}>
                <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>
                  {saving ? '...' : 'Salva'}
                </Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Input
                label="Nome *"
                value={shelfName}
                onChangeText={setShelfName}
                placeholder="es. A1, B2, C3"
              />
              
              {/* Barcode with scan button */}
              <View style={styles.barcodeRow}>
                <View style={styles.barcodeInputContainer}>
                  <Input
                    label="Barcode *"
                    value={shelfBarcode}
                    onChangeText={setShelfBarcode}
                    placeholder="es. SD-W-A1"
                    autoCapitalize="characters"
                  />
                </View>
                <TouchableOpacity
                  style={styles.scanBarcodeButton}
                  onPress={() => setShowBarcodeScanner(true)}
                >
                  <Ionicons name="scan" size={24} color="#fff" />
                  <Text style={styles.scanBarcodeText}>Scansiona</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.inputLabel}>Location *</Text>
              {locations.length === 0 ? (
                <Text style={styles.noLocationsText}>
                  Nessuna location disponibile. Crea prima una location.
                </Text>
              ) : (
                <View style={styles.locationPicker}>
                  {locations.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      style={[
                        styles.locationOption,
                        shelfLocationId === loc.id && styles.locationOptionActive,
                      ]}
                      onPress={() => setShelfLocationId(loc.id)}
                    >
                      <Ionicons 
                        name={shelfLocationId === loc.id ? "checkmark-circle" : "ellipse-outline"} 
                        size={20} 
                        color={shelfLocationId === loc.id ? "#fff" : "#666"} 
                      />
                      <Text style={[
                        styles.locationOptionText,
                        shelfLocationId === loc.id && styles.locationOptionTextActive,
                      ]}>
                        {loc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Barcode Scanner */}
      <BarcodeScanner
        visible={showBarcodeScanner}
        onClose={() => setShowBarcodeScanner(false)}
        onScan={handleBarcodeScan}
        title="Scansiona Barcode Scaffale"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#000',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#000',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  itemDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  itemMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  itemBarcode: {
    fontSize: 13,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0px 4px 10px rgba(0,0,0,0.25)',
      },
    }),
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  modalCancel: {
    fontSize: 16,
    color: '#666',
  },
  modalSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
    marginTop: 8,
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 8,
  },
  barcodeInputContainer: {
    flex: 1,
  },
  scanBarcodeButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  scanBarcodeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  noLocationsText: {
    fontSize: 14,
    color: '#dc2626',
    fontStyle: 'italic',
    marginBottom: 16,
  },
  locationPicker: {
    gap: 8,
    marginBottom: 16,
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 12,
  },
  locationOptionActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  locationOptionText: {
    fontSize: 15,
    color: '#000',
    fontWeight: '500',
  },
  locationOptionTextActive: {
    color: '#fff',
  },
});
