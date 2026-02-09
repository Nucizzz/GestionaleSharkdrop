import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  Platform, 
  Vibration, 
  Dimensions,
  Animated,
  Easing
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCAN_AREA_SIZE = Math.min(SCREEN_WIDTH * 0.8, 300);

interface BarcodeScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
}

export function BarcodeScanner({ visible, onClose, onScan, title = 'Scansiona Barcode' }: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef<any>(null);
  
  // Animation for scan line
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  
  // Animation for the scanning indicator
  useEffect(() => {
    if (visible && !scanned) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 2000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [visible, scanned, scanLineAnim]);

  useEffect(() => {
    if (visible) {
      setScanned(false);
      setLastScannedCode(null);
      setIsCameraReady(false);
    }
  }, [visible]);

  const handleBarCodeScanned = useCallback(({ data, type }: { data: string; type: string }) => {
    if (scanned || !data) return;
    
    console.log('Barcode scanned:', data, 'Type:', type);
    
    // Vibrate to give feedback
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 100, 50, 100]); // Double vibration pattern
    }
    
    setScanned(true);
    setLastScannedCode(data);
    
    // Short delay before closing to show feedback
    setTimeout(() => {
      onScan(data);
      onClose();
    }, 400);
  }, [scanned, onScan, onClose]);

  const resetScanner = useCallback(() => {
    setScanned(false);
    setLastScannedCode(null);
  }, []);

  const handleCameraReady = useCallback(() => {
    console.log('Camera ready');
    setIsCameraReady(true);
  }, []);

  if (!permission) {
    return null;
  }

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCAN_AREA_SIZE - 4],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {!permission.granted ? (
          <View style={styles.permissionContainer}>
            <View style={styles.permissionCard}>
              <Ionicons name="camera-outline" size={64} color="#000" />
              <Text style={styles.permissionTitle}>Accesso Fotocamera</Text>
              <Text style={styles.permissionText}>
                Per scansionare i barcode è necessario l'accesso alla fotocamera del dispositivo.
              </Text>
              <Button
                title="Consenti Accesso"
                onPress={requestPermission}
                style={{ marginTop: 24, width: '100%' }}
              />
              <TouchableOpacity style={styles.cancelPermButton} onPress={onClose}>
                <Text style={styles.cancelPermText}>Annulla</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torch}
              onCameraReady={handleCameraReady}
              barcodeScannerSettings={{
                barcodeTypes: [
                  'ean13', 
                  'ean8', 
                  'upc_a', 
                  'upc_e', 
                  'code39', 
                  'code128', 
                  'codabar', 
                  'itf14', 
                  'qr',
                  'pdf417',
                  'aztec',
                  'datamatrix'
                ],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity 
                onPress={onClose} 
                style={styles.headerButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity 
                onPress={() => setTorch(!torch)} 
                style={styles.headerButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons 
                  name={torch ? "flash" : "flash-outline"} 
                  size={24} 
                  color={torch ? "#fbbf24" : "#fff"} 
                />
              </TouchableOpacity>
            </View>
            
            {/* Overlay with scan area */}
            <View style={styles.overlay}>
              {/* Top section */}
              <View style={styles.overlaySection} />
              
              {/* Middle row with scan area */}
              <View style={styles.middleRow}>
                <View style={styles.overlaySide} />
                
                {/* Scan Area */}
                <View style={styles.scanAreaContainer}>
                  <View style={styles.scanArea}>
                    {/* Corner markers */}
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                    
                    {/* Animated scan line */}
                    {!scanned && isCameraReady && (
                      <Animated.View 
                        style={[
                          styles.scanLine,
                          { transform: [{ translateY: scanLineTranslateY }] }
                        ]} 
                      />
                    )}
                    
                    {/* Success indicator */}
                    {scanned && (
                      <View style={styles.successOverlay}>
                        <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
                        <Text style={styles.successText}>Scansionato!</Text>
                      </View>
                    )}
                  </View>
                </View>
                
                <View style={styles.overlaySide} />
              </View>
              
              {/* Bottom section with info */}
              <View style={styles.bottomSection}>
                {/* Camera status */}
                {!isCameraReady && (
                  <View style={styles.loadingContainer}>
                    <Text style={styles.loadingText}>Attivazione fotocamera...</Text>
                  </View>
                )}
                
                {/* Instructions */}
                <Text style={styles.instruction}>
                  {scanned 
                    ? `Codice: ${lastScannedCode}` 
                    : 'Posiziona il barcode nel riquadro'}
                </Text>
                
                {/* Tips */}
                {!scanned && (
                  <View style={styles.tipsContainer}>
                    <View style={styles.tip}>
                      <Ionicons name="sunny-outline" size={16} color="#fff" />
                      <Text style={styles.tipText}>Assicurati di avere buona illuminazione</Text>
                    </View>
                    <View style={styles.tip}>
                      <Ionicons name="hand-left-outline" size={16} color="#fff" />
                      <Text style={styles.tipText}>Tieni il telefono fermo</Text>
                    </View>
                    <View style={styles.tip}>
                      <Ionicons name="resize-outline" size={16} color="#fff" />
                      <Text style={styles.tipText}>Distanza: 10-30 cm</Text>
                    </View>
                  </View>
                )}
                
                {/* Rescan button */}
                {scanned && (
                  <TouchableOpacity 
                    style={styles.rescanButton} 
                    onPress={resetScanner}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={styles.rescanText}>Scansiona di nuovo</Text>
                  </TouchableOpacity>
                )}
                
                {/* Torch hint */}
                {!scanned && !torch && (
                  <Text style={styles.torchHint}>
                    Premi l'icona flash in alto per attivare la torcia
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  permissionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0px 2px 8px rgba(0,0,0,0.1)',
      },
    }),
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginTop: 16,
  },
  permissionText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  cancelPermButton: {
    marginTop: 16,
    padding: 12,
  },
  cancelPermText: {
    color: '#666',
    fontSize: 14,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  overlaySection: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  middleRow: {
    flexDirection: 'row',
    height: SCAN_AREA_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  scanAreaContainer: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    padding: 2,
  },
  scanArea: {
    flex: 1,
    position: 'relative',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#22c55e',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  scanLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: '#22c55e',
    borderRadius: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#22c55e',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: '0px 0px 8px rgba(34,197,94,0.8)',
      },
    }),
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
  },
  successText: {
    color: '#22c55e',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  bottomSection: {
    flex: 1.2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  loadingContainer: {
    marginBottom: 16,
  },
  loadingText: {
    color: '#fbbf24',
    fontSize: 14,
  },
  instruction: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  tipsContainer: {
    width: '100%',
    marginTop: 8,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  tipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginLeft: 12,
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22c55e',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 25,
    marginTop: 16,
  },
  rescanText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  torchHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
