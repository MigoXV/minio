package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

func TestAccessUsesPeerInsteadOfForwardingHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unauthorized request reached MinIO")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	proxy := handler(target, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}, false)
	r := httptest.NewRequest(http.MethodGet, "https://storage.example/", nil)
	r.RemoteAddr = "203.0.113.9:45000"
	r.Header.Set("X-Forwarded-For", "10.0.0.1")
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unexpected access status: %d", w.Code)
	}
}

func TestProxyPreservesSignedRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		if r.Host != "storage.example:9000" || r.RequestURI != "/bucket/a%2Fb?partNumber=2&uploadId=abc%2Bdef" ||
			r.Header.Get("Authorization") != "AWS4-HMAC-SHA256 test" || string(data) != "payload" {
			t.Errorf("proxy changed a signed request: host=%s URI=%s", r.Host, r.RequestURI)
		}
		if r.Header.Get("X-Forwarded-For") != "10.0.0.2" || r.Header.Get("X-Forwarded-Proto") != "https" {
			t.Error("untrusted forwarding headers were retained")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	proxy := handler(target, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}, false)
	r := httptest.NewRequest(http.MethodPut, "https://storage.example:9000/bucket/a%2Fb?partNumber=2&uploadId=abc%2Bdef", strings.NewReader("payload"))
	r.RemoteAddr = "10.0.0.2:45678"
	r.Header.Set("Authorization", "AWS4-HMAC-SHA256 test")
	r.Header.Set("X-Forwarded-For", "10.0.0.99")
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("upstream status lost: %d", w.Code)
	}
}

func TestRejectBroadPublicAccess(t *testing.T) {
	for _, cidrs := range [][]string{nil, {"0.0.0.0/0"}, {"::/0"}, {"203.0.113.0/24"}, {"10.0.0.0/7"}} {
		if _, err := lanPrefixes(cidrs); err == nil {
			t.Fatalf("unsafe CIDRs accepted: %v", cidrs)
		}
	}
}
