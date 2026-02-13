export default function Footer() {
    return (
        <footer className="bg-muted border-t border-border mt-auto mb-16 md:mb-0">
            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Company Info */}
                    <div>
                        <h3 className="font-bold text-lg mb-4">Migunani Motor</h3>
                        <p className="text-sm text-muted-foreground">
                            Penyedia suku cadang motor terpercaya dengan harga terbaik.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h3 className="font-bold text-lg mb-4">Quick Links</h3>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li>
                                <a href="/catalog" className="hover:text-primary">
                                    Katalog Produk
                                </a>
                            </li>
                            <li>
                                <a href="/about" className="hover:text-primary">
                                    Tentang Kami
                                </a>
                            </li>
                            <li>
                                <a href="/contact" className="hover:text-primary">
                                    Kontak
                                </a>
                            </li>
                        </ul>
                    </div>

                    {/* Contact */}
                    <div>
                        <h3 className="font-bold text-lg mb-4">Kontak Kami</h3>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li>WhatsApp: +62 xxx-xxxx-xxxx</li>
                            <li>Email: info@migunanimotor.com</li>
                            <li>Alamat: Jakarta, Indonesia</li>
                        </ul>
                    </div>
                </div>

                <div className="mt-8 pt-8 border-t border-border text-center text-sm text-muted-foreground">
                    <p>&copy; {new Date().getFullYear()} Migunani Motor. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
}
