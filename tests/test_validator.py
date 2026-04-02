import unittest
from validator import validate_ads_txt


class TestCaseNormalization(unittest.TestCase):
    def test_lowercase_domain_and_publisher(self):
        corrected, _ = validate_ads_txt("Example.COM, PUB123, direct")
        self.assertIn("example.com", corrected)
        self.assertIn("pub123", corrected)
        self.assertIn("DIRECT", corrected)

    def test_uppercase_relationship(self):
        corrected, _ = validate_ads_txt("example.com, pub, reseller")
        self.assertIn("RESELLER", corrected)

    def test_mixed_case_cert_id_preserved(self):
        corrected, _ = validate_ads_txt("example.com, pub, DIRECT, f08c47fec0942fa0")
        self.assertIn("f08c47fec0942fa0", corrected)


class TestDuplicateRemoval(unittest.TestCase):
    def test_exact_duplicate(self):
        content = "example.com, pub, DIRECT, cert\nexample.com, pub, DIRECT, cert"
        corrected, notes = validate_ads_txt(content)
        self.assertEqual(corrected.count("example.com"), 1)
        self.assertTrue(any("Duplicate" in n for n in notes))

    def test_case_insensitive_duplicate(self):
        content = "Example.COM, PUB, DIRECT\nexample.com, pub, direct"
        corrected, notes = validate_ads_txt(content)
        self.assertEqual(corrected.count("example.com"), 1)

    def test_different_cert_id_not_duplicate(self):
        content = "example.com, pub, DIRECT, cert1\nexample.com, pub, DIRECT, cert2"
        corrected, notes = validate_ads_txt(content)
        self.assertEqual(corrected.count("example.com"), 2)

    def test_no_false_duplicate_different_publisher(self):
        content = "example.com, pub1, DIRECT\nexample.com, pub2, DIRECT"
        corrected, notes = validate_ads_txt(content)
        self.assertFalse(any("Duplicate" in n for n in notes))


class TestCASignatureVerification(unittest.TestCase):
    def test_known_ca_verified(self):
        _, notes = validate_ads_txt("example.com, pub, DIRECT, f08c47fec0942fa0")
        self.assertTrue(any("verified" in n for n in notes))

    def test_unknown_ca_warning(self):
        _, notes = validate_ads_txt("example.com, pub, DIRECT, unknown-tag-xyz")
        self.assertTrue(any("not in known TAG registry" in n for n in notes))

    def test_invalid_cert_id_characters(self):
        _, notes = validate_ads_txt("example.com, pub, DIRECT, bad cert!")
        self.assertTrue(any("invalid characters" in n for n in notes))

    def test_no_cert_id_no_warning(self):
        _, notes = validate_ads_txt("example.com, pub, DIRECT")
        self.assertFalse(any("Certification" in n for n in notes))


class TestFieldValidation(unittest.TestCase):
    def test_invalid_domain(self):
        _, notes = validate_ads_txt("-invalid-.com, pub, DIRECT")
        self.assertTrue(any("Invalid domain" in n for n in notes))

    def test_invalid_relationship(self):
        _, notes = validate_ads_txt("example.com, pub, PARTNER")
        self.assertTrue(any("Invalid relationship" in n for n in notes))

    def test_too_few_fields_skipped(self):
        corrected, notes = validate_ads_txt("example.com, pub")
        self.assertNotIn("example.com", corrected)
        self.assertTrue(any("Invalid format" in n for n in notes))

    def test_empty_publisher_id(self):
        _, notes = validate_ads_txt("example.com, , DIRECT")
        self.assertTrue(any("Empty publisher" in n for n in notes))


class TestCommentAndBlankLines(unittest.TestCase):
    def test_comments_preserved(self):
        content = "# This is a comment\nexample.com, pub, DIRECT"
        corrected, _ = validate_ads_txt(content)
        self.assertIn("# This is a comment", corrected)

    def test_blank_lines_preserved(self):
        content = "example.com, pub, DIRECT\n\nexample2.com, pub2, RESELLER"
        corrected, _ = validate_ads_txt(content)
        self.assertIn("\n\n", corrected)


class TestVariableDeclarations(unittest.TestCase):
    def test_contact_variable(self):
        content = "CONTACT=admin@example.com\nexample.com, pub, DIRECT"
        corrected, notes = validate_ads_txt(content)
        self.assertIn("CONTACT=admin@example.com", corrected)
        self.assertFalse(any("Unsupported variable" in n for n in notes))

    def test_unsupported_variable_warning(self):
        _, notes = validate_ads_txt("FOOBAR=value\nexample.com, pub, DIRECT")
        self.assertTrue(any("Unsupported variable" in n for n in notes))

    def test_multiple_ownerdomain_warning(self):
        content = "OWNERDOMAIN=foo.com\nOWNERDOMAIN=bar.com\nexample.com, pub, DIRECT"
        _, notes = validate_ads_txt(content)
        self.assertTrue(any("Multiple OWNERDOMAIN" in n for n in notes))

    def test_subdomain_variable(self):
        content = "SUBDOMAIN=sub.example.com\nexample.com, pub, DIRECT"
        corrected, notes = validate_ads_txt(content)
        self.assertIn("SUBDOMAIN=sub.example.com", corrected)


class TestExtensionField(unittest.TestCase):
    def test_extension_preserved(self):
        content = "example.com, pub, DIRECT; ext=value"
        corrected, _ = validate_ads_txt(content)
        self.assertIn("; ext=value", corrected)


class TestEmptyContent(unittest.TestCase):
    def test_empty_file_no_records(self):
        corrected, notes = validate_ads_txt("")
        self.assertTrue(any("no valid data records" in n for n in notes))

    def test_only_comments(self):
        _, notes = validate_ads_txt("# just a comment\n# another comment")
        self.assertTrue(any("no valid data records" in n for n in notes))


if __name__ == '__main__':
    unittest.main()
