import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAppStore } from '../src/store/appStore';
import { useAuthStore } from '../src/store/authStore';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { BarcodeScanner } from '../src/components/BarcodeScanner';
import { Location, Shelf, Product, ProductVariant } from '../src/types';

type OperationType = 'receive' | 'move' | 'transfer' | 'sale' | 'adjust';

const operationConfig: Record<OperationType, { title: string; icon: string; color: string }> = {
  receive: { title: 'Ricevi Inventario', icon: 'add-circle-outline', color: '#16a34a' },
  move: { title: 'Sposta tra Scaffali', icon: 'swap-horizontal-outline', color: '#2563eb' },
  transfer: { title: 'Trasferisci Location', icon: 'arrow-forward-outline', color: '#7c3aed' },
  sale: { title: 'Registra Vendita', icon: 'cart-outline', color: '#dc2626' },
  adjust: { title: 'Rettifica Inventario', icon: 'construct-outline', color: '#f59e0b' },
};

export default function OperationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; barcode?: string; product_id?: string; variant_id?: string; location_id?: string; shelf_id?: string }>();
  const { scannedProduct, setScannedProduct, currentShelf, setCurrentShelf } = useAppStore();
  const { user } = useAuthStore();

  const [operationType, setOperationType] = useState<OperationType>((params.type as OperationType) || 'receive');
  const [locations, setLocations] = useState<Location[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState<'product' | 'fromShelf' | 'toShelf'>('product');
  const [loading, setLoading] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Form state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [fromLocation, setFromLocation] = useState<Location | null>(null);
  const [toLocation, setToLocation] = useState<Location | null>(null);
  const [fromShelf, setFromShelf] = useState<Shelf | null>(null);
  const [toShelf, setToShelf] = useState<Shelf | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [salePrice, setSalePrice] = useState('');
  const [note, setNote] = useState('');
  const [currentInventory, setCurrentInventory] = useState<number | null>(null);
  const safeBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [router]);

  // Load locations and shelves
  useEffect(() => {
    loadData();
  }, []);

  // Handle initial barcode from params
  useEffect(() => {
    // If product is already injected from scan store, avoid a second lookup.
    if (params.barcode && !scannedProduct && !selectedProduct) {
      handleProductScan(params.barcode);
    }
  }, [params.barcode, scannedProduct, selectedProduct]);

  useEffect(() => {
    const loadFromParams = async () => {
      if (!params.product_id) return;
      try {
        const product = await api.getProduct(params.product_id);
        setSelectedProduct(product);
        if (params.variant_id) {
          const variant = product.variants?.find((v: ProductVariant) => v.id === params.variant_id);
          if (variant) setSelectedVariant(variant);
        }
      } catch (error) {
        // ignore
      }
    };
    loadFromParams();
  }, [params.product_id, params.variant_id]);

  // Handle scanned product from store
  useEffect(() => {
    if (scannedProduct) {
      setSelectedProduct(scannedProduct.product);
      setSelectedVariant(scannedProduct.variant);
      setScannedProduct(null);
    }
  }, [scannedProduct]);

  // Use current shelf if set
  useEffect(() => {
    if (currentShelf && !fromShelf) {
      setFromShelf(currentShelf);
      // Find location for this shelf
      const loc = locations.find(l => l.id === currentShelf.location_id);
      if (loc) setFromLocation(loc);
    }
  }, [currentShelf, locations]);

  // Load current inventory when variant and location change
  useEffect(() => {
    if (selectedVariant && fromLocation) {
      loadCurrentInventory();
    }
  }, [selectedVariant, fromLocation, fromShelf]);

  // Debounced product search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await api.getProducts(q, 20, 0);
        setSearchResults(data.products || []);
      } catch (e) {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadData = async () => {
    try {
      const [locs, shelvesData] = await Promise.all([
        api.getLocations(),
        api.getShelves(),
      ]);
      setLocations(locs);
      setShelves(shelvesData);
      if (params.location_id) {
        const loc = locs.find((l) => l.id === params.location_id);
        if (loc) {
          setFromLocation(loc);
          setToLocation(loc);
        }
      } else if (locs.length > 0 && !fromLocation) {
        setFromLocation(locs[0]);
      }
      if (params.shelf_id) {
        const shelf = shelvesData.find((s) => s.id === params.shelf_id);
        if (shelf) {
          setFromShelf(shelf);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const loadCurrentInventory = async () => {
    if (!selectedVariant || !fromLocation) return;
    try {
      const inventory = await api.getInventory(fromLocation.id, fromShelf?.id);
      const item = inventory.find((i: any) => i.variant_id === selectedVariant.id);
      setCurrentInventory(item?.quantity || 0);
    } catch (error) {
      setCurrentInventory(0);
    }
  };

  const handleProductScan = async (barcode: string) => {
    try {
      const result = await api.findProductByBarcode(barcode);
      setSelectedProduct(result.product);
      setSelectedVariant(result.variant);
    } catch (error: any) {
      if (error?.response?.status && error.response.status !== 404) {
        Alert.alert('Errore', 'Errore di rete durante la ricerca del prodotto.');
        return;
      }
      if (operationType === 'receive') {
        router.push(`/caricaprodottionline?barcode=${encodeURIComponent(barcode)}`);
        return;
      }
      Alert.alert(
        'Non Trovato',
        `Prodotto con barcode ${barcode} non trovato nel sistema.\nVuoi cercarlo su StockX?`,
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Cerca su StockX',
            onPress: () => {
              router.push(`/caricaprodottionline?barcode=${encodeURIComponent(barcode)}`);
            },
          },
        ]
      );
    }
  };

  const selectProductVariant = (product: Product, variant: ProductVariant) => {
    setSelectedProduct(product);
    setSelectedVariant(variant);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleShelfScan = async (barcode: string, target: 'fromShelf' | 'toShelf') => {
    try {
      const shelf = await api.getShelfByBarcode(barcode);
      if (target === 'fromShelf') {
        setFromShelf(shelf);
        const loc = locations.find(l => l.id === shelf.location_id);
        if (loc) setFromLocation(loc);
      } else {
        setToShelf(shelf);
        const loc = locations.find(l => l.id === shelf.location_id);
        if (loc) setToLocation(loc);
      }
    } catch (error) {
      Alert.alert('Non Trovato', `Scaffale con barcode ${barcode} non trovato.`);
    }
  };

  const handleScan = (barcode: string) => {
    if (scanTarget === 'product') {
      handleProductScan(barcode);
    } else {
      handleShelfScan(barcode, scanTarget);
    }
  };

  const openScanner = (target: 'product' | 'fromShelf' | 'toShelf') => {
    setScanTarget(target);
    setShowScanner(true);
  };

  const validateForm = (): boolean => {
    if (!selectedVariant) {
      Alert.alert('Errore', 'Seleziona un prodotto');
      return false;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Errore', 'Inserisci una quantità valida');
      return false;
    }

    if (operationType === 'sale') {
      const price = parseFloat(salePrice);
      if (isNaN(price) || price <= 0) {
        Alert.alert('Errore', 'Inserisci un prezzo di vendita valido');
        return false;
      }
    }

    if (operationType === 'move') {
      if (!fromShelf || !toShelf) {
        Alert.alert('Errore', 'Seleziona scaffale di partenza e destinazione');
        return false;
      }
      if (fromShelf.id === toShelf.id) {
        Alert.alert('Errore', 'Gli scaffali devono essere diversi');
        return false;
      }
    }

    if (operationType === 'transfer') {
      if (!fromLocation || !toLocation) {
        Alert.alert('Errore', 'Seleziona location di partenza e destinazione');
        return false;
      }
      if (fromLocation.id === toLocation.id) {
        Alert.alert('Errore', 'Le location devono essere diverse');
        return false;
      }
    }

    if (['sale', 'move', 'transfer'].includes(operationType)) {
      if (currentInventory !== null && qty > currentInventory) {
        Alert.alert('Errore', `Quantità insufficiente. Disponibile: ${currentInventory}`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const qty = parseInt(quantity);

      switch (operationType) {
        case 'receive':
          await api.receiveInventory({
            variant_id: selectedVariant!.id,
            location_id: fromLocation!.id,
            shelf_id: fromShelf?.id,
            quantity: qty,
          });
          break;

        case 'move':
          await api.moveInventory({
            variant_id: selectedVariant!.id,
            location_id: fromLocation!.id,
            from_shelf_id: fromShelf!.id,
            to_shelf_id: toShelf!.id,
            quantity: qty,
          });
          break;

        case 'transfer':
          await api.transferInventory({
            variant_id: selectedVariant!.id,
            from_location_id: fromLocation!.id,
            to_location_id: toLocation!.id,
            from_shelf_id: fromShelf?.id,
            to_shelf_id: toShelf?.id,
            quantity: qty,
          });
          break;

        case 'sale':
          await api.saleInventory({
            variant_id: selectedVariant!.id,
            location_id: fromLocation!.id,
            shelf_id: fromShelf?.id,
            quantity: qty,
            sale_price: parseFloat(salePrice),
          });
          break;

        case 'adjust':
          await api.adjustInventory({
            variant_id: selectedVariant!.id,
            location_id: fromLocation!.id,
            shelf_id: fromShelf?.id,
            new_quantity: qty,
            note: note || undefined,
          });
          break;
      }

      Alert.alert('Successo', 'Operazione completata', [
        { text: 'OK', onPress: safeBack }
      ]);
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Operazione fallita');
    } finally {
      setLoading(false);
    }
  };

  const config = operationConfig[operationType];
  const filteredShelves = shelves.filter(s => 
    operationType === 'transfer' 
      ? true 
      : s.location_id === fromLocation?.id
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>{config.title}</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Operation Type Selector */}
        <View style={styles.typeSelector}>
          {(Object.keys(operationConfig) as OperationType[]).map((type) => {
            const cfg = operationConfig[type];
            const isActive = operationType === type;
            const isDisabled = type === 'adjust' && user?.role !== 'admin';
            return (
              <TouchableOpacity
                key={type}
                style={[
                  styles.typeButton,
                  isActive && { backgroundColor: cfg.color },
                  isDisabled && styles.typeButtonDisabled,
                ]}
                onPress={() => !isDisabled && setOperationType(type)}
                disabled={isDisabled}
              >
                <Ionicons 
                  name={cfg.icon as any} 
                  size={20} 
                  color={isActive ? '#fff' : isDisabled ? '#ccc' : '#666'} 
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Product Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prodotto</Text>
          {selectedProduct ? (
            <View style={styles.productCard}>
              <View style={styles.productImageContainer}>
                {selectedProduct.image_base64 || selectedProduct.image_url ? (
                  <Image
                    source={{ uri: selectedProduct.image_base64 || selectedProduct.image_url }}
                    style={styles.productImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="image-outline" size={32} color="#ccc" />
                )}
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productTitle} numberOfLines={2}>{selectedProduct.title}</Text>
                {selectedVariant && (
                  <>
                    <Text style={styles.variantTitle}>{selectedVariant.title}</Text>
                      <Text style={styles.variantBarcode}>{selectedVariant.barcode}</Text>
                      {selectedVariant.upc_backup && selectedVariant.upc_backup !== selectedVariant.barcode && (
                        <Text style={styles.variantBarcodeSecondary}>UPC backup: {selectedVariant.upc_backup}</Text>
                      )}
                  </>
                )}
              </View>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setSelectedProduct(null);
                  setSelectedVariant(null);
                }}
              >
                <Ionicons name="close-circle" size={24} color="#dc2626" />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.scanProductButton}
                onPress={() => openScanner('product')}
              >
                <Ionicons name="barcode-outline" size={32} color="#000" />
                <Text style={styles.scanProductText}>Scansiona Prodotto</Text>
              </TouchableOpacity>

              <View style={styles.manualEntry}>
                <Text style={styles.manualLabel}>Inserisci Barcode</Text>
                <View style={styles.manualRow}>
                  <Input
                    value={manualBarcode}
                    onChangeText={setManualBarcode}
                    placeholder="Barcode..."
                    containerStyle={{ flex: 1, marginBottom: 0 }}
                  />
                  <TouchableOpacity
                    style={styles.manualButton}
                    onPress={() => manualBarcode.trim() && handleProductScan(manualBarcode.trim())}
                  >
                    <Ionicons name="search" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.manualEntry}>
                <Text style={styles.manualLabel}>Cerca per nome</Text>
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={18} color="#999" />
                  <Input
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Es. Yeezy 350"
                    containerStyle={{ flex: 1, marginBottom: 0 }}
                  />
                </View>
                {searchLoading && <Text style={styles.searchHint}>Ricerca in corso...</Text>}
                {searchResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchResults.map((p) => (
                      <View key={p.id} style={styles.searchItem}>
                        <Text style={styles.searchTitle} numberOfLines={1}>{p.title}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {p.variants.map((v) => (
                            <TouchableOpacity
                              key={v.id}
                              style={styles.searchVariant}
                              onPress={() => selectProductVariant(p, v)}
                            >
                              <Text style={styles.searchVariantText}>{v.title}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          {/* Variant Selector */}
          {selectedProduct && selectedProduct.variants.length > 1 && (
            <View style={styles.variantSelector}>
              <Text style={styles.variantSelectorLabel}>Seleziona Variante:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {selectedProduct.variants.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.variantChip,
                      selectedVariant?.id === v.id && styles.variantChipActive,
                    ]}
                    onPress={() => setSelectedVariant(v)}
                  >
                    <Text style={[
                      styles.variantChipText,
                      selectedVariant?.id === v.id && styles.variantChipTextActive,
                    ]}>
                      {v.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Location Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {operationType === 'transfer' ? 'Da Location' : 'Location'}
          </Text>
          <View style={styles.locationSelector}>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                style={[
                  styles.locationChip,
                  fromLocation?.id === loc.id && styles.locationChipActive,
                ]}
                onPress={() => {
                  setFromLocation(loc);
                  setFromShelf(null);
                }}
              >
                <Text style={[
                  styles.locationChipText,
                  fromLocation?.id === loc.id && styles.locationChipTextActive,
                ]}>
                  {loc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* To Location (for transfer) */}
        {operationType === 'transfer' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>A Location</Text>
            <View style={styles.locationSelector}>
              {locations.map((loc) => (
                <TouchableOpacity
                  key={loc.id}
                  style={[
                    styles.locationChip,
                    toLocation?.id === loc.id && styles.locationChipActive,
                  ]}
                  onPress={() => {
                    setToLocation(loc);
                    setToShelf(null);
                  }}
                >
                  <Text style={[
                    styles.locationChipText,
                    toLocation?.id === loc.id && styles.locationChipTextActive,
                  ]}>
                    {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Shelf Selection */}
        {['receive', 'move', 'sale', 'adjust'].includes(operationType) && filteredShelves.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {operationType === 'move' ? 'Da Scaffale' : 'Scaffale'}
            </Text>
            <View style={styles.shelfSelector}>
              <TouchableOpacity
                style={styles.scanShelfButton}
                onPress={() => openScanner('fromShelf')}
              >
                <Ionicons name="scan-outline" size={20} color="#000" />
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  style={[
                    styles.shelfChip,
                    !fromShelf && styles.shelfChipActive,
                  ]}
                  onPress={() => setFromShelf(null)}
                >
                  <Text style={[
                    styles.shelfChipText,
                    !fromShelf && styles.shelfChipTextActive,
                  ]}>
                    Nessuno
                  </Text>
                </TouchableOpacity>
                {filteredShelves.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.shelfChip,
                      fromShelf?.id === s.id && styles.shelfChipActive,
                    ]}
                    onPress={() => setFromShelf(s)}
                  >
                    <Text style={[
                      styles.shelfChipText,
                      fromShelf?.id === s.id && styles.shelfChipTextActive,
                    ]}>
                      {s.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        )}

        {/* To Shelf (for move) */}
        {operationType === 'move' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>A Scaffale</Text>
            <View style={styles.shelfSelector}>
              <TouchableOpacity
                style={styles.scanShelfButton}
                onPress={() => openScanner('toShelf')}
              >
                <Ionicons name="scan-outline" size={20} color="#000" />
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {filteredShelves.filter(s => s.id !== fromShelf?.id).map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.shelfChip,
                      toShelf?.id === s.id && styles.shelfChipActive,
                    ]}
                    onPress={() => setToShelf(s)}
                  >
                    <Text style={[
                      styles.shelfChipText,
                      toShelf?.id === s.id && styles.shelfChipTextActive,
                    ]}>
                      {s.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        )}

        {/* Current Inventory */}
        {currentInventory !== null && ['sale', 'move', 'transfer'].includes(operationType) && (
          <View style={styles.inventoryInfo}>
            <Text style={styles.inventoryLabel}>Disponibile:</Text>
            <Text style={styles.inventoryValue}>{currentInventory} pz</Text>
          </View>
        )}

        {/* Quantity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {operationType === 'adjust' ? 'Nuova Quantità' : 'Quantità'}
          </Text>
          <View style={styles.quantityContainer}>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity(String(Math.max(1, parseInt(quantity) - 1)))}
            >
              <Ionicons name="remove" size={24} color="#000" />
            </TouchableOpacity>
            <Input
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="number-pad"
              style={styles.quantityInput}
              containerStyle={{ flex: 1, marginBottom: 0, marginHorizontal: 12 }}
            />
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity(String(parseInt(quantity) + 1))}
            >
              <Ionicons name="add" size={24} color="#000" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sale Price */}
        {operationType === 'sale' && (
          <View style={styles.section}>
            <Input
              label="Prezzo di Vendita (€) *"
              value={salePrice}
              onChangeText={setSalePrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>
        )}

        {/* Note (for adjust) */}
        {operationType === 'adjust' && (
          <View style={styles.section}>
            <Input
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="Motivo della rettifica..."
              multiline
            />
          </View>
        )}

        {/* Submit Button */}
        <View style={styles.submitContainer}>
          <Button
            title={loading ? 'Elaborazione...' : config.title}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading || !selectedVariant}
            size="large"
            style={{ backgroundColor: config.color }}
          />
        </View>
      </ScrollView>

      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScan}
        title={
          scanTarget === 'product' ? 'Scansiona Prodotto' :
          scanTarget === 'fromShelf' ? 'Scansiona Scaffale Partenza' :
          'Scansiona Scaffale Destinazione'
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  typeSelector: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  typeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  typeButtonDisabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  productCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  productImageContainer: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  variantTitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  variantBarcode: {
    fontSize: 11,
    color: '#999',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  variantBarcodeSecondary: {
    fontSize: 11,
    color: '#6b7280',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  clearButton: {
    padding: 4,
  },
  scanProductButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000',
    borderStyle: 'dashed',
  },
  scanProductText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginTop: 8,
  },
  manualEntry: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  manualLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualButton: {
    backgroundColor: '#000',
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
  },
  searchResults: {
    marginTop: 8,
    gap: 8,
  },
  searchItem: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  searchVariant: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginRight: 6,
  },
  searchVariantText: {
    fontSize: 12,
    color: '#111827',
  },
  variantSelector: {
    marginTop: 12,
  },
  variantSelectorLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  variantChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    marginRight: 8,
  },
  variantChipActive: {
    backgroundColor: '#000',
  },
  variantChipText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  variantChipTextActive: {
    color: '#fff',
  },
  locationSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  locationChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  locationChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  locationChipText: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  locationChipTextActive: {
    color: '#fff',
  },
  shelfSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanShelfButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  shelfChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  shelfChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  shelfChipText: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  shelfChipTextActive: {
    color: '#fff',
  },
  inventoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  inventoryLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  inventoryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  quantityInput: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
  },
  submitContainer: {
    marginTop: 16,
  },
});
