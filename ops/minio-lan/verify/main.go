// Command verify checks a running deployment, using credentials supplied on stdin.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type config struct {
	S3URL        string `json:"s3URL"`
	ConsoleURL   string `json:"consoleURL"`
	RootUser     string `json:"rootUser"`
	RootPassword string `json:"rootPassword"`
	CAPEM        string `json:"caPEM"`
}

func run() error {
	var cfg config
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20)).Decode(&cfg); err != nil {
		return err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(cfg.CAPEM)) {
		return fmt.Errorf("missing CA certificate")
	}
	s3URL, err := url.Parse(cfg.S3URL)
	if err != nil || s3URL.Scheme != "https" || s3URL.Host == "" {
		return fmt.Errorf("S3 URL must use HTTPS")
	}
	consoleURL, err := url.Parse(cfg.ConsoleURL)
	if err != nil || consoleURL.Scheme != "https" || consoleURL.Host == "" {
		return fmt.Errorf("console URL must use HTTPS")
	}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, ResponseHeaderTimeout: 15 * time.Second}
	httpClient := &http.Client{Transport: transport, Timeout: 30 * time.Second}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	for _, check := range []struct {
		name, address string
		status        int
	}{
		{"S3 readiness and trusted TLS", cfg.S3URL + "/minio/health/ready", 200},
		{"Console HTML and trusted TLS", cfg.ConsoleURL + "/", 200},
		{"Anonymous S3 request denied", cfg.S3URL + "/", 403},
		{"Anonymous console API denied", cfg.ConsoleURL + "/api/v1/buckets", 403},
	} {
		r, err := httpClient.Get(check.address)
		if err != nil {
			return fmt.Errorf("%s: %w", check.name, err)
		}
		_, _ = io.Copy(io.Discard, r.Body)
		r.Body.Close()
		if r.StatusCode != check.status {
			return fmt.Errorf("%s: expected %d, received %d", check.name, check.status, r.StatusCode)
		}
		fmt.Printf("PASS %s (%d)\n", check.name, r.StatusCode)
	}
	loginBody, _ := json.Marshal(map[string]string{"accessKey": cfg.RootUser, "secretKey": cfg.RootPassword})
	response, err := httpClient.Post(cfg.ConsoleURL+"/api/v1/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		return fmt.Errorf("console login: %w", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("console login: HTTP %d", response.StatusCode)
	}
	fmt.Printf("PASS Console administrator login (%d)\n", response.StatusCode)
	client, err := minio.New(s3URL.Host, &minio.Options{
		Creds: credentials.NewStaticV4(cfg.RootUser, cfg.RootPassword, ""), Secure: true,
		Transport: transport, Region: "us-east-1", BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return err
	}
	if _, err := client.ListBuckets(ctx); err != nil {
		return fmt.Errorf("signed bucket listing: %w", err)
	}
	fmt.Println("PASS Signed S3 administrator authentication")
	bucket := fmt.Sprintf("lan-verify-%d", time.Now().UnixNano())
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("create verification bucket: %w", err)
	}
	cleaned := false
	defer func() {
		if cleaned {
			return
		}
		cleanup, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		_ = client.RemoveObject(cleanup, bucket, "test-object", minio.RemoveObjectOptions{})
		if err := client.RemoveBucket(cleanup, bucket); err != nil {
			fmt.Fprintln(os.Stderr, "Verification bucket cleanup requires attention:", bucket, err)
		}
	}()
	payload := bytes.Repeat([]byte("LAN TLS S3 verification\n"), 8192)
	if _, err := client.PutObject(ctx, bucket, "test-object", bytes.NewReader(payload), int64(len(payload)), minio.PutObjectOptions{ContentType: "text/plain"}); err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	obj, err := client.GetObject(ctx, bucket, "test-object", minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	data, err := io.ReadAll(obj)
	obj.Close()
	if err != nil || sha256.Sum256(data) != sha256.Sum256(payload) {
		return fmt.Errorf("download content verification failed: %v", err)
	}
	response, err = httpClient.Get(strings.TrimSuffix(cfg.S3URL, "/") + "/" + bucket + "/test-object")
	if err != nil {
		return err
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		return fmt.Errorf("anonymous object download expected 403, got %d", response.StatusCode)
	}
	fmt.Printf("PASS Create bucket, upload, download and SHA256 match (%d bytes); anonymous object access denied\n", len(data))
	if err := client.RemoveObject(ctx, bucket, "test-object", minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete verification object: %w", err)
	}
	if err := client.RemoveBucket(ctx, bucket); err != nil {
		return fmt.Errorf("delete verification bucket: %w", err)
	}
	cleaned = true
	fmt.Println("PASS Verification object and bucket removed")
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
