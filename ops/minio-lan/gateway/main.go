// Command gateway exposes the loopback MinIO listeners over TLS to selected LANs.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type config struct {
	S3Listen        string   `json:"s3Listen"`
	ConsoleListen   string   `json:"consoleListen"`
	AllowedCIDRs    []string `json:"allowedCIDRs"`
	AllowAllSources bool     `json:"allowAllSources"`
	TLSCert         string   `json:"tlsCert"`
	TLSKey          string   `json:"tlsKey"`
}

func allowed(remote string, prefixes []netip.Prefix) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	for _, prefix := range prefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

func lanPrefixes(cidrs []string) ([]netip.Prefix, error) {
	if len(cidrs) == 0 {
		return nil, errors.New("allowedCIDRs must explicitly select at least one LAN")
	}
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	private := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12"),
		netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("127.0.0.0/8"),
		netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("::1/128"),
	}
	for _, cidr := range cidrs {
		p, err := netip.ParsePrefix(cidr)
		if err != nil {
			return nil, fmt.Errorf("invalid allowed CIDR: %w", err)
		}
		p = p.Masked()
		valid := false
		for _, parent := range private {
			if p.Bits() >= parent.Bits() && parent.Contains(p.Addr()) {
				valid = true
			}
		}
		if !valid {
			return nil, errors.New("this LAN gateway only accepts private or loopback CIDRs")
		}
		prefixes = append(prefixes, p)
	}
	return prefixes, nil
}

func handler(target *url.URL, prefixes []netip.Prefix, console bool) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			// SigV4 signs Host; preserve the host and port supplied by the client.
			r.Out.Host = r.In.Host
			r.SetXForwarded()
			r.Out.Header.Set("X-Forwarded-Proto", "https")
		},
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			MaxIdleConns:          128,
			MaxIdleConnsPerHost:   64,
			IdleConnTimeout:       90 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			DisableCompression:    true,
		},
		ModifyResponse: func(r *http.Response) error {
			r.Header.Set("X-Content-Type-Options", "nosniff")
			if console {
				r.Header.Set("Referrer-Policy", "no-referrer")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("upstream unavailable: %v", err)
			http.Error(w, "service unavailable", http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only the TCP peer determines access; forwarding headers are untrusted.
		if !allowed(r.RemoteAddr, prefixes) {
			http.Error(w, "source network is not allowed", http.StatusForbidden)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func run(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var cfg config
	decoder := json.NewDecoder(f)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return err
	}
	var prefixes []netip.Prefix
	if cfg.AllowAllSources {
		prefixes = []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0")}
	} else {
		prefixes, err = lanPrefixes(cfg.AllowedCIDRs)
		if err != nil {
			return err
		}
	}
	resolve := func(p string) string {
		if filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(filepath.Dir(path), p)
	}
	cert, err := tls.LoadX509KeyPair(resolve(cfg.TLSCert), resolve(cfg.TLSKey))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 2)
	var servers []*http.Server
	for i, addr := range []string{cfg.S3Listen, cfg.ConsoleListen} {
		if strings.TrimSpace(addr) == "" {
			return errors.New("both listen addresses must be configured")
		}
		upstream := &url.URL{Scheme: "http", Host: "127.0.0.1:19000"}
		if i == 1 {
			upstream.Host = "127.0.0.1:19001"
		}
		srv := &http.Server{
			Addr:              addr,
			Handler:           handler(upstream, prefixes, i == 1),
			TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}},
			ReadHeaderTimeout: 10 * time.Second,
			IdleTimeout:       120 * time.Second,
			MaxHeaderBytes:    1 << 20,
		}
		servers = append(servers, srv)
		listener, err := net.Listen("tcp", addr)
		if err != nil {
			for _, started := range servers {
				_ = started.Close()
			}
			return err
		}
		go func() {
			log.Printf("TLS listener ready on %s", srv.Addr)
			errCh <- srv.Serve(tls.NewListener(listener, srv.TLSConfig))
		}()
	}
	select {
	case <-ctx.Done():
	case err = <-errCh:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, srv := range servers {
		_ = srv.Shutdown(shutdown)
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	path := flag.String("config", "", "path to a local gateway JSON configuration")
	flag.Parse()
	if *path == "" {
		log.Fatal("-config is required")
	}
	if err := run(*path); err != nil {
		log.Fatal(err)
	}
}
