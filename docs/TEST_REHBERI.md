# Elle test rehberi (v0.1)

Bu rehber, Varak'ı kendi bilgisayarınızda adım adım denemeniz içindir. Otomatik testlerin kapsamı
[TESTING.md](TESTING.md) dosyasında; bilinen sınırlamalar [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) dosyasındadır.
İlk sürüm olduğu için **gerçek dosyalarınızın kopyalarıyla** çalışın.

## 1. Kurulum

Seçeneklerden birini kullanın:

- **Kurulum dosyası:** `release\Varak-Setup-0.1.0-x64.exe`. Henüz yayımlanmış bir sürüm yok: bu dosyayı (ve
  aşağıdaki ZIP'i) proje klasöründe [Kaynaktan derleme](../README.tr.md#kaynaktan-derleme) adımlarıyla
  (`npm run dist:win -- --publish never`) üretin. Yönetici izni istemez; yalnızca sizin kullanıcı
  hesabınıza kurulur. Kurulum dosyası henüz imzalı olmadığı için Windows SmartScreen "Windows bilgisayarınızı
  korudu" uyarısı gösterebilir: **Ek bilgi → Yine de çalıştır**.
- **Taşınabilir sürüm:** `release\Varak-0.1.0-x64.zip` dosyasını bir klasöre çıkarıp `Varak.exe`'yi çalıştırın.
- **Geliştirici modu:** proje klasöründe `npm run dev`.

Kaldırmak için: **Ayarlar → Uygulamalar → Varak → Kaldır**. Ayarlar `%APPDATA%\Varak`, motor profilleri, kurtarma
dosyaları ve günlükler `%LOCALAPPDATA%\Varak` altında tutulur.

## 2. Genel kontroller

| # | Adım | Beklenen |
|---|---|---|
| G1 | Uygulamayı açın | Başlangıç ekranı: Boş belge / Boş hesap tablosu / Boş sunu, Dosya aç…, PDF aç…, Son kullanılanlar |
| G2 | Seçenekler (başlangıç ekranının altında; belge açıkken Dosya → Seçenekler) → Arayüz dili: English, sonra Türkçe | Tüm arayüz dili anında değişir |
| G3 | Seçenekler → Tema: Koyu / Açık / Sistem ayarını kullan | Arayüz renkleri değişir; belge sayfası beyaz kalır |
| G4 | Birden fazla belge açın, Ctrl+Tab ile gezin | Sekmeler arasında geçiş yapılır, her belge kendi şeridini gösterir |
| G5 | Şeride bir kez tıklayın, sonra Alt (veya F10) tuşuna basın | Şerit sekmelerinde tuş ipuçları (KeyTips) görünür; harfle sekme/komut seçilir, Esc kapatır. Belge içinde yazarken de istiyorsanız: Dosya → Seçenekler → "Belgede çalışırken tuş ipuçları (Alt veya F10) — deneysel" |
| G6 | Ctrl+F1 | Şerit daralır/genişler |
| G7 | Belgeye tıklayıp yazın; sonra şeritteki Yazı tipi kutusuna tıklayıp "Arial" yazın, Enter | Harfler kutuya yazılır, belgeye değil; Enter sonrası belgeye yazmaya devam edebilirsiniz. Şerit sekmesine (ör. Ekle) tıklamak ise klavyeyi belgede bırakır |

## 3. Belge (DOCX)

| # | Adım | Beklenen |
|---|---|---|
| B1 | Yeni belge; "Çağrı İşçi ığdır ÖŞÜ" yazın | Türkçe karakterler doğru görünür |
| B2 | Metni seçip Kalın, İtalik, Altı çizili, yazı tipi, boyut, renk uygulayın | Biçimler uygulanır; şeritteki düğmeler seçili durumu gösterir |
| B3 | Ortala / Sola / Sağa / İki yana yasla; madde işareti ve numaralandırma | Paragraf biçimi değişir |
| B4 | Stiller galerisinden Başlık 1 | Paragraf başlık olur |
| B5 | Ekle → Tablo, Resim, Bağlantı | Öğeler eklenir; tabloya tıklayınca bağlama özgü "Tablo" sekmesi çıkar |
| B6 | Düzen → Sayfa yapısı; açılan iletişim kutusunda kenar boşluklarını, yönlendirmeyi ve kağıt boyutunu değiştirin | Sayfa düzeni değişir |
| B7 | Ctrl+S → DOCX olarak kaydedin, belgeyi kapatın, yeniden açın | Tüm değişiklikler yerinde |
| B8 | Ctrl+Z / Ctrl+Y | Geri al / yinele çalışır |
| B9 | Dosya → PDF olarak dışa aktar | PDF oluşur ve PDF modülünde açılabilir |
| B10 | Dosya → Yazdır | Yazdırma iletişim kutusu açılır (önizleme dahil) |

## 4. Hesap tablosu (XLSX)

| # | Adım | Beklenen |
|---|---|---|
| H1 | A1=1,5 A2=2,25 A3=`=TOPLA(A1:A2)` | A3 = 3,75 (Türkçe ayarda ondalık virgül) |
| H2 | Formül çubuğunda A3'e tıklayın | Formül Türkçe işlev adlarıyla görünür |
| H3 | `=EĞER(A3>3;"büyük";"küçük")`, `=DÜŞEYARA(...)`, `$A$1` mutlak başvuru, başka sayfaya başvuru | Doğru sonuçlar; kopyalayınca göreli/mutlak başvurular doğru davranır |
| H4 | Sayı biçimleri: para birimi, yüzde, tarih | Hücre biçimi değişir |
| H5 | Veri → Sırala, Filtre; Görünüm → Bölmeleri dondur | Çalışır |
| H6 | Durum çubuğunda seçimin Toplam/Ortalama/Sayı değerleri | Görünür |
| H7 | Kaydet (XLSX), kapat, yeniden aç | Değerler ve formüller yerinde, yeniden hesaplanmış |
| H8 | CSV içe aktarın (noktalı virgül ayırıcı) | Önizlemeli içe aktarma iletişim kutusu çıkar; sütunlar doğru ayrılır |

## 5. Sunu (PPTX)

| # | Adım | Beklenen |
|---|---|---|
| S1 | Yeni sunu; başlık ve metin kutusuna yazın | Metin görünür |
| S2 | Yeni slayt, Slaytı çoğalt, Slaydı sil; Düzen menüsünden düzen seçin | Soldaki "Slaytlar" paneli güncellenir; durum çubuğu "Slayt 2 / 4" gibi 1'den sayar |
| S3 | Resim ve şekil ekleyin; taşıyın, boyutlandırın, döndürün | Nesneler düzenlenebilir |
| S4 | F5 / Shift+F5 | Sunu baştan / geçerli slayttan başlar; Esc ile çıkılır |
| S5 | Kaydet (PPTX), kapat, yeniden aç | Slaytlar, metinler ve resimler yerinde |

## 6. PDF

| # | Adım | Beklenen |
|---|---|---|
| P1 | Bir PDF açın | Sayfalar ve küçük resimler görünür; yakınlaştırma ve döndürme çalışır |
| P2 | Ctrl+F ile "istanbul" arayın | "İSTANBUL" yazımları da bulunur |
| P3 | Metin seçip kopyalayın | Pano metni doğru |
| P4 | Vurgulama, serbest metin (Türkçe), çizim, resim damgası, yorum ekleyin | Eklenir; Kaydet sonrası yeniden açınca durur |
| P5 | Form alanlarını doldurun | Kaydet sonrası değerler durur |
| P6 | Sayfaları döndürün, silin, sürükleyerek sıralayın; başka PDF birleştirin; seçili sayfaları ayrı PDF'e çıkarın | Sonuç dosyaları doğru |
| P7 | "Metin ekle" / "Resim ekle" (sayfa içeriği olarak) | Türkçe metin doğru görünür |
| P8 | Kaydedilen PDF'i Chrome/Edge'de açın | Türkçe notlar ve form değerleri görünür |

## 7. Veri güvenliği

| # | Adım | Beklenen |
|---|---|---|
| V1 | Makro içeren bir DOCM/XLSM'yi DOCX/XLSX olarak kaydetmeyi deneyin | Kayıp uyarısı: "Kopya kaydet… / Yine de kaydet / ODF olarak kaydet / İptal"; "Kopya kaydet…" seçilidir |
| V2 | Değiştirilmiş belgeyi kapatmayı deneyin | "Değişiklikler kaydedilsin mi?" sorusu: Kaydet / Kaydetme / İptal |
| V3 | Belgeyi değiştirin, otomatik kayıt süresi kadar (varsayılan 3 dk) bekleyin, sonra Görev Yöneticisi'nden `soffice.bin` sürecini sonlandırın | Motor yeniden başlar; "Belge, en son otomatik kurtarma kopyasından geri yüklendi…" bildirimi; o kopyadan sonraki değişiklikler yoktur |
| V4 | Belgeyi değiştirip otomatik kaydı bekleyin, Varak'ı Görev Yöneticisi'nden sonlandırıp yeniden açın | Başlangıç ekranında "Kaydedilmemiş 1 belge kurtarılabilir." bandı → Göster → Geri yükle |
| V5 | (İleri düzey) Belgeyi değiştirip otomatik kaydı bekleyin; Kaynak İzleyicisi'nde (resmon) CPU sekmesinde belgenin `soffice.bin` sürecini (belgeye yazarken CPU kullanan; Varak bir yedek motor da çalıştırır, yanlışını seçerseniz bir şey olmaz, devam ettirip diğerini deneyin) → İşlemi askıya al | Varak penceresi tıklamalara yanıt vermez; yaklaşık 13 sn sonra (Varak motorun yanıt vermediğini ~5 sn'de fark eder, ardından 8 sn bekler) ayrı bir "Varak" penceresi "Motoru yeniden başlat / Bekle" sorar. "Motoru yeniden başlat" → belge otomatik kayıttan açılır ve yazmaya devam edilir. "Bekle" seçerseniz süreci Kaynak İzleyicisi'nde devam ettirin |

## 8. Sorun bildirirken

Uygulama sürümünü (Dosya → Hakkında), Windows sürümünü, modülü, dosya türünü, adımları ve mümkünse ekran görüntüsünü
yazın. **Gizli belge paylaşmayın.** Günlük dosyaları `%LOCALAPPDATA%\Varak\logs` altındadır; belge içeriği
içermezler ama dosya adları geçebilir.
