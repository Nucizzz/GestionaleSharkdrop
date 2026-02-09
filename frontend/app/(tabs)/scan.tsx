import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { api } from '../../src/services/api';
import { useAppStore } from '../../src/store/appStore';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setScannedProduct, setCurrentShelf, currentShelf } = useAppStore();
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState<'product' | 'shelf'>('product');
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const handleScan = useCallback(async (barcode: string) => {
    setLastScanned(barcode);
    
    if (scanMode === 'shelf') {
      // Scanning a shelf
      try {
        const shelf = await api.getShelfByBarcode(barcode);
        setCurrentShelf(shelf);
        Alert.alert('Scaffale Selezionato', `${shelf.name}`);
      } catch (error: any) {
        Alert.alert('Errore', 'Scaffale non trovato');
      }
    } else {
      // Scanning a product
      try {
        const result = await api.findProductByBarcode(barcode);
        setScannedProduct(result);
        router.push('/operation');
      } catch (error: any) {
        if (error?.response?.status && error.response.status !== 404) {
          Alert.alert('Errore', 'Errore di rete durante la ricerca. Riprova.');
          return;
        }
        Alert.alert(
          'Prodotto Non Trovato',
          `Barcode: ${barcode}\n\nQuesto prodotto non è nel sistema. Vuoi cercarlo su StockX e caricarlo online?`,
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
    }
  }, [scanMode, setCurrentShelf, setScannedProduct, router]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Scansiona</Text>
        <Text style={styles.subtitle}>Usa la fotocamera per scansionare</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Current Shelf */}
        {currentShelf && (
          <View style={styles.currentShelfCard}>
            <View style={styles.currentShelfInfo}>
              <Text style={styles.currentShelfLabel}>Scaffale Attivo</Text>
              <Text style={styles.currentShelfName}>{currentShelf.name}</Text>
              <Text style={styles.currentShelfBarcode}>{currentShelf.barcode}</Text>
            </View>
            <TouchableOpacity
              style={styles.clearShelfButton}
              onPress={() => setCurrentShelf(null)}
            >
              <Ionicons name="close-circle" size={24} color="#dc2626" />
            </TouchableOpacity>
          </View>
        )}

        {/* Scan Mode Toggle */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeButton, scanMode === 'product' && styles.modeButtonActive]}
            onPress={() => setScanMode('product')}
          >
            <Ionicons name="pricetag-outline" size={20} color={scanMode === 'product' ? '#fff' : '#000'} />
            <Text style={[styles.modeButtonText, scanMode === 'product' && styles.modeButtonTextActive]}>
              Prodotto
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, scanMode === 'shelf' && styles.modeButtonActive]}
            onPress={() => setScanMode('shelf')}
          >
            <Ionicons name="grid-outline" size={20} color={scanMode === 'shelf' ? '#fff' : '#000'} />
            <Text style={[styles.modeButtonText, scanMode === 'shelf' && styles.modeButtonTextActive]}>
              Scaffale
            </Text>
          </TouchableOpacity>
        </View>

        {/* Main Scan Button */}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => setShowScanner(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="scan-outline" size={64} color="#fff" />
          <Text style={styles.scanButtonText}>
            {scanMode === 'product' ? 'Scansiona Prodotto' : 'Scansiona Scaffale'}
          </Text>
          <Text style={styles.scanButtonHint}>Tocca per aprire la fotocamera</Text>
        </TouchableOpacity>

        {/* Last Scanned */}
        {lastScanned && (
          <View style={styles.lastScanned}>
            <Text style={styles.lastScannedLabel}>Ultimo codice scansionato:</Text>
            <Text style={styles.lastScannedValue}>{lastScanned}</Text>
          </View>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Operazioni Rapide</Text>
        <View style={styles.quickActions}>
          {[
            { icon: 'add-circle-outline', label: 'Ricevi', action: 'receive', color: '#16a34a' },
            { icon: 'swap-horizontal-outline', label: 'Sposta', action: 'move', color: '#2563eb' },
            { icon: 'arrow-forward-outline', label: 'Trasferisci', action: 'transfer', color: '#7c3aed' },
            { icon: 'cart-outline', label: 'Vendita', action: 'sale', color: '#dc2626' },
          ].map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.quickAction}
              onPress={() => router.push(`/operation?type=${item.action}`)}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: item.color + '15' }]}>
                <Ionicons name={item.icon as any} size={24} color={item.color} />
              </View>
              <Text style={styles.quickActionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScan}
        title={scanMode === 'product' ? 'Scansiona Prodotto' : 'Scansiona Scaffale'}
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
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  currentShelfCard: {
    backgroundColor: '#000',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  currentShelfInfo: {
    flex: 1,
  },
  currentShelfLabel: {
    color: '#999',
    fontSize: 12,
  },
  currentShelfName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  currentShelfBarcode: {
    color: '#999',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  clearShelfButton: {
    padding: 8,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  modeButtonActive: {
    backgroundColor: '#000',
  },
  modeButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  modeButtonTextActive: {
    color: '#fff',
  },
  scanButton: {
    backgroundColor: '#000',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
  },
  scanButtonHint: {
    color: '#999',
    fontSize: 12,
    marginTop: 8,
  },
  lastScanned: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  lastScannedLabel: {
    fontSize: 12,
    color: '#666',
  },
  lastScannedValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  quickAction: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: '1%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginTop: 8,
  },
});
