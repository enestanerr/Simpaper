# Elle test rehberi (v0.1)

Bu rehber, Simpaper'ı kendi bilgisayarınızda adım adım denemeniz içindir. Otomatik testlerin kapsamı
[TESTING.md](TESTING.md) dosyasında; bilinen sınırlamalar [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) dosyasındadır.
İlk sürüm olduğu için **gerçek dosyalarınızın kopyalarıyla** çalışın.

## 1. Kurulum

Seçeneklerden birini kullanın:

- **Kurulum dosyası:** `release\Simpaper-Setup-0.1.0-x64.exe`. Henüz yayımlanmış bir sürüm yok: bu dosyayı (ve
  aşağıdaki ZIP'i) proje klasöründe [Kaynaktan derleme](../README.tr.md#kaynaktan-derleme) adımlarıyla
  (`npm run dist:win -- --publish never`) üretin. Yönetici izni istemez; yalnızca sizin kullanıcı
  hesabınıza kurulur. Kurulum dosyası henüz imzalı olmadığı için Windows SmartScreen "Windows bilgisayarınızı
  korudu" uyarısı gösterebilir: **Ek bilgi → Yine de çalıştır**. Bilgisayarda eski adla kurulmuş bir **Varak**
  test sürümü varsa önce onu kaldırın (2. bölüm, D1).
- **Taşınabilir sürüm:** `release\Simpaper-0.1.0-x64.zip` dosyasını bir klasöre çıkarıp `Simpaper.exe`'yi çalıştırın.
  Bu sürüm dosya türlerini Windows'a kaydetmez.
- **Geliştirici modu:** proje klasöründe `npm run dev`.

Kaldırmak için: **Ayarlar → Uygulamalar → Simpaper → Kaldır**. Ayarlar `%APPDATA%\Simpaper`, motor profilleri, kurtarma
dosyaları ve günlükler `%LOCALAPPDATA%\Simpaper` altında tutulur.

## 2. Dosya türleri ve simgeler

Kurulum programı belgeleri, hesap tablolarını, sunuları ve PDF dosyalarını Simpaper'ın simgeleriyle Windows'a
kaydeder (ayrıntılar: [ADR 0010](adr/0010-file-associations.md)). Başka bir uygulamaya ait türleri değiştirmez: bir
türü hangi uygulamanın açacağına Windows'ta yalnızca siz karar verirsiniz. ZIP sürümü ve geliştirici modu dosya
türlerini kaydetmez; bu bölümü kurulum dosyasıyla yapın. Bu adımlar henüz gerçek bir kurulumda denenmedi;
beklenenden farklı olanları not edin.

Hazırlık: ayrı bir deneme klasörüne birer .docx, .xlsx, .pptx, .odt, .pdf ve .txt dosyası koyun (kendi
dosyalarınızın kopyaları ya da proje klasöründe `npm run corpus:generate` ile üretilen `tests\corpus\generated`
örnekleri; .odt ve .txt örnekleri `derived` alt klasöründedir ve yalnızca motor indirilmişse, yani
`npm run engine:fetch` sonrasında üretilir).

| # | Adım | Beklenen |
|---|---|---|
| D1 | Eski adla yapılmış bir Varak test kurulumu varsa kaldırın: **Ayarlar → Uygulamalar → Varak → Kaldır** | Varak, uygulama listesinden kalkar. Simpaper yeni bir uygulama kimliğiyle gelir; Varak kaldırılmazsa onun yerine değil yanına kurulur. Simpaper, Varak'ın `%APPDATA%\Varak` ve `%LOCALAPPDATA%\Varak` klasörlerini okumaz, ayarlarınızı da taşımaz; bu klasörler kalırsa silebilirsiniz |
| D2 | `release\Simpaper-Setup-0.1.0-x64.exe` ile kurun (1. bölüm); **Yükleme Ayarlarını Seçin** sayfasında varsayılan "Sadece benim için" seçeneğini değiştirmeyin | Son sayfadaki "Simpaper'ı Windows Ayarları'nda varsayılan yap" kutusu işaretsiz gelir. İşaretleyip kurulumu bitirirseniz Windows Ayarları'nda Simpaper'ın varsayılan uygulamalar sayfası açılır; şimdilik orada bir şey değiştirmeden kapatın |
| D3 | Dosya Gezgini'nde deneme klasörünü açın (Görünüm → Ayrıntılar) | Başka bir uygulamaya (ör. Microsoft Office, LibreOffice) ait olmayan .docx, .xlsx, .pptx ve .odt dosyaları Simpaper'ın simgeleriyle görünür: beyaz bir sayfa, modül renginde bir kenar (belge mavi, hesap tablosu yeşil, sunu turuncu) ve modülün işareti. "Tür" sütununda kurulum dilindeki ad yazar (ör. "Word Belgesi", "Excel Çalışma Kitabı", "PowerPoint Sunusu", "OpenDocument Metni"). Başka bir uygulamada kalan türler için D5'e bakın |
| D4 | .docx, .xlsx, .pptx ve .odt dosyalarına çift tıklayın | Başka bir uygulamaya ait olmayan türler Simpaper'da açılır; Simpaper kapalıysa başlar. Windows hangi uygulamayla açılacağını sorarsa ya da bir tür başka bir uygulamada açılırsa D5'e bakın |
| D5 | .pdf dosyasına (ve Simpaper'da açılmadıysa .xlsx dosyasına) çift tıklayın | Daha önce başka bir uygulamaya bağlanmış türler eski seçimde kalabilir ya da Windows hangi uygulamayla açılacağını sorabilir. Geliştirme bilgisayarında bunlar .xlsx (orada daha önce eski Varak derlemesi için "Her zaman" seçilmişti) ve .pdf'tir (Microsoft Edge). Windows sorarsa Simpaper'ı seçip **Her zaman**'a basın. Sormazsa şu yollardan biriyle seçin: Simpaper'da Dosya → Seçenekler → Dosya türleri → **Varsayılan uygulamaları seç…** (D7) ya da Windows'ta **Ayarlar → Uygulamalar → Varsayılan uygulamalar → Simpaper** |
| D6 | Seçenekler sayfasını açın (başlangıç ekranının altında; belge açıkken Dosya → Seçenekler) ve en alttaki **Dosya türleri** bölümüne inin | Dört satır: Belgeler, Hesap tabloları, Sunular, PDF dosyaları. Her birinde "Simpaper ile açılıyor", "n / m tür Simpaper ile açılıyor" ya da "Başka bir uygulamayla açılıyor" yazar ve bu, D3–D5'te gördüğünüzle uyuşur (ör. .pdf hâlâ Edge'de açılıyorsa PDF dosyaları satırında "Başka bir uygulamayla açılıyor"). "Bu Simpaper kopyası dosya türlerini Windows'a kaydetmedi…" ya da "…başka bir Simpaper kurulumunu başlatıyor" notu görünmez |
| D7 | **Varsayılan uygulamaları seç…** düğmesine basın; açılan sayfada Simpaper ile açılmayan bir türü (ör. .pdf) Simpaper'a geçirin (türün yanındaki uygulamaya tıklayıp Simpaper'ı seçin), sonra Simpaper penceresine dönün | Windows Ayarları doğrudan Simpaper'ın sayfasında açılır (Windows 11'de: 21H2/22H2'de Nisan 2023 güncellemesiyle, 23H2 ve sonrası; Windows 10'da varsayılan uygulamalar listesi açılır, oradan Simpaper'ı seçin). Simpaper'a dönünce Dosya türleri bölümü, uygulamayı yeniden başlatmadan güncellenir (ör. PDF dosyaları: "Simpaper ile açılıyor"). O türün dosyaları Simpaper'ın simgesiyle görünür ve çift tıklayınca Simpaper'da açılır. İsterseniz aynı sayfadan eski uygulamaya geri dönebilirsiniz |
| D8 | .txt dosyasına çift tıklayın; sonra sağ tıklayıp **Birlikte aç** menüsüne bakın | Dosya eskisi gibi Not Defteri'nde (ya da önceki uygulamasında) açılır; Simpaper, "Birlikte aç" menüsünde yalnızca bir seçenek olarak görünür |
| D9 | Simpaper ile açılan üç dosyayı (ör. .docx, .xlsx, .pptx) Dosya Gezgini'nde Ctrl ile tıklayarak seçip Enter'a basın; önce Simpaper kapalıyken, sonra açıkken deneyin | Üç dosya tek bir Simpaper penceresinde, her biri kendi sekmesinde, birbiri ardına açılır; ikinci bir Simpaper penceresi açılmaz |
| D10 | En sonda, diğer bölümleri bitirdikten sonra: **Ayarlar → Uygulamalar → Simpaper → Kaldır**; sonra deneme klasörünü yeniden açın (gerekirse F5 ile yenileyin) | Simpaper'ın simgeleri kaybolur; dosyalar önceki uygulamalarının simgeleriyle ya da genel bir simgeyle görünür. Çift tıklayınca önceki uygulamalarıyla açılır ya da Windows hangi uygulamayla açılacağını sorar. Simpaper, "Birlikte aç" menüsünden ve Ayarlar → Uygulamalar → Varsayılan uygulamalar listesinden kalkar |

## 3. Genel kontroller

| # | Adım | Beklenen |
|---|---|---|
| G1 | Uygulamayı açın | Başlangıç ekranı: Boş belge / Boş hesap tablosu / Boş sunu, Dosya aç…, PDF aç…, Son kullanılanlar |
| G2 | Seçenekler (başlangıç ekranının altında; belge açıkken Dosya → Seçenekler) → Arayüz dili: English, sonra Türkçe | Tüm arayüz dili anında değişir |
| G3 | Seçenekler → Tema: Koyu / Açık / Sistem ayarını kullan | Arayüz renkleri değişir; belge sayfası beyaz kalır |
| G4 | Birden fazla belge açın, Ctrl+Tab ile gezin | Sekmeler arasında geçiş yapılır, her belge kendi şeridini gösterir |
| G5 | Şeride bir kez tıklayın, sonra Alt (veya F10) tuşuna basın | Şerit sekmelerinde tuş ipuçları (KeyTips) görünür; harfle sekme/komut seçilir, Esc kapatır. Belge içinde yazarken de istiyorsanız: Dosya → Seçenekler → "Belgede çalışırken tuş ipuçları (Alt veya F10) — deneysel" |
| G6 | Ctrl+F1 | Şerit daralır/genişler |
| G7 | Belgeye tıklayıp yazın; sonra şeritteki Yazı tipi kutusuna tıklayıp "Arial" yazın, Enter | Harfler kutuya yazılır, belgeye değil; Enter sonrası belgeye yazmaya devam edebilirsiniz. Şerit sekmesine (ör. Ekle) tıklamak ise klavyeyi belgede bırakır |

## 4. Belge (DOCX)

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

## 5. Hesap tablosu (XLSX)

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

## 6. Sunu (PPTX)

| # | Adım | Beklenen |
|---|---|---|
| S1 | Yeni sunu; başlık ve metin kutusuna yazın | Metin görünür |
| S2 | Yeni slayt, Slaytı çoğalt, Slaydı sil; Düzen menüsünden düzen seçin | Soldaki "Slaytlar" paneli güncellenir; durum çubuğu "Slayt 2 / 4" gibi 1'den sayar |
| S3 | Resim ve şekil ekleyin; taşıyın, boyutlandırın, döndürün | Nesneler düzenlenebilir |
| S4 | F5 / Shift+F5 | Sunu baştan / geçerli slayttan başlar; Esc ile çıkılır |
| S5 | Kaydet (PPTX), kapat, yeniden aç | Slaytlar, metinler ve resimler yerinde |

## 7. PDF

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

## 8. Veri güvenliği

| # | Adım | Beklenen |
|---|---|---|
| V1 | Makro içeren bir DOCM/XLSM'yi DOCX/XLSX olarak kaydetmeyi deneyin | Kayıp uyarısı: "Kopya kaydet… / Yine de kaydet / ODF olarak kaydet / İptal"; "Kopya kaydet…" seçilidir |
| V2 | Değiştirilmiş belgeyi kapatmayı deneyin | "Değişiklikler kaydedilsin mi?" sorusu: Kaydet / Kaydetme / İptal |
| V3 | Belgeyi değiştirin, otomatik kayıt süresi kadar (varsayılan 3 dk) bekleyin, sonra Görev Yöneticisi'nden `soffice.bin` sürecini sonlandırın | Motor yeniden başlar; "Belge, en son otomatik kurtarma kopyasından geri yüklendi…" bildirimi; o kopyadan sonraki değişiklikler yoktur |
| V4 | Belgeyi değiştirip otomatik kaydı bekleyin, Simpaper'ı Görev Yöneticisi'nden sonlandırıp yeniden açın | Başlangıç ekranında "Kaydedilmemiş 1 belge kurtarılabilir." bandı → Göster → Geri yükle |
| V5 | (İleri düzey) Belgeyi değiştirip otomatik kaydı bekleyin; Kaynak İzleyicisi'nde (resmon) CPU sekmesinde belgenin `soffice.bin` sürecini (belgeye yazarken CPU kullanan; Simpaper bir yedek motor da çalıştırır, yanlışını seçerseniz bir şey olmaz, devam ettirip diğerini deneyin) → İşlemi askıya al | Simpaper penceresi tıklamalara yanıt vermez; yaklaşık 13 sn sonra (Simpaper motorun yanıt vermediğini ~5 sn'de fark eder, ardından 8 sn bekler) ayrı bir "Simpaper" penceresi "Motoru yeniden başlat / Bekle" sorar. "Motoru yeniden başlat" → belge otomatik kayıttan açılır ve yazmaya devam edilir. "Bekle" seçerseniz süreci Kaynak İzleyicisi'nde devam ettirin |

## 9. Sorun bildirirken

Uygulama sürümünü (Dosya → Hakkında), Windows sürümünü, modülü, dosya türünü, adımları ve mümkünse ekran görüntüsünü
yazın. **Gizli belge paylaşmayın.** Günlük dosyaları `%LOCALAPPDATA%\Simpaper\logs` altındadır; belge içeriği
içermezler ama dosya adları geçebilir.
